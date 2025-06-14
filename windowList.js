import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import { EventEmitter } from 'resource:///org/gnome/shell/misc/signals.js'
import {WindowButton} from './windowButton.js';
import {FavoritesButton} from './favoritesButton.js';

const DRAG_TIMEOUT_INTERVAL_MS = 50;

function getWindowId(window) {
    // We use mutter's stable sequence numbers to identify windows
    return window.get_stable_sequence();
}

export class WindowListManager {
    // Class to coordinate between window lists on different monitors to ensure the
    // order of window buttons is kept in sync. WindowList instances connect to the
    // `events` object which emits the following signals:
    //
    // - window-appended (window): a new window has been created and each WindowList
    //   should append a new window button to the end of its list
    //
    // - window-removed (index): a window has been closed and each WindowList should
    //   remove the corresponding windowButton from its list
    // 
    // - window-moved (src_index, dst_index) a window has been moved in the ordering,
    //   and each windowList should move the window button at src_index to dst_index
    //
    // When a WindowList wants to reorder window buttons due a drag and drop operation,
    // it should call WindowListManager.moveWindow(src_index, dst_index), and then
    // respond to the emitted signal, in order to ensure the move is synced across all
    // WindowList.
    //
    // This class saves the window button order to gsettings upon destruction and loads
    // it at startup, in order to best-as-possible preserve the ordering across screen
    // locks, suspends, and extensions being disabled and enabled.

    constructor() {
        this.events = new EventEmitter();
        // Ordered array of windows, which the order of window buttons in each window
        // list is kept in sync with.
        this._windows = [];

        global.display.connectObject(
            'window-created',
            this._onWindowCreated.bind(this),
            this,
        )
    }

    get_initial_windows() {
        // Get all currently existing windows, populate our list and emit events for all
        // window lists to create their buttons. This should be called by the main
        // extension after all window lists have been created

        // Saved window order as a list of windowIds:
        const savedWindowIDs = [] // TODO load from gsettings:
        // Convert to map:
        const savedIndices = new Map(savedWindowIDs.map((windowId, ix) => [windowId, ix]));
        // Sort windows according to saved order, or put them at the end if not present:
        const windowActors = global.get_window_actors()
        windowActors.sort((a, b) => {
            const aIndex = savedIndices.get(getWindowId(a.meta_window)) ?? Infinity;
            const bIndex = savedIndices.get(getWindowId(b.meta_window)) ?? Infinity;
            return aIndex - bIndex;
        });
        windowActors.forEach(windowActor => {
            this._onWindowCreated(global.display, windowActor.meta_window);
        });
    }

    _onWindowCreated(display, window) {
        window.connectObject(
            'unmanaged',
            this._onWindowUnmanaged.bind(this),
            this,
        )
        this._windows.push(window);
        this.events.emit('window-appended', window);
    }

    _onWindowUnmanaged(window) {
        const index = this._windows.indexOf(window);
        this._windows.splice(index, 1);
        this.events.emit('window-removed', index);
    }

    moveWindow(src_index, dst_index) {
        if (!(src_index < this._windows.length && dst_index < this._windows.length)) {
            throw new Error(`invalid indices ${src_index},${dst_index} (len=${this._windows.length})`);
        };
        const window = this._windows[src_index];
        this._windows.splice(src_index, 1);
        this._windows.splice(dst_index, 0, window);
        this.events.emit('window-moved', src_index, dst_index);
    }

    destroy() {
        // TODO save this to gsettings:
        const order = this._windows.map(window => getWindowId(window));

        // Disconnect signals
        global.display.disconnectObject(this);
        this._windows.forEach(window => {
            window.disconnectObject(this);
        });

        // Destroy event emitter to ensure it doesn't hold references to window lists:
        this.events.destroy();
    }
}


export class WindowList {
    constructor(panel, manager) {
        this.panel = panel;
        this.manager = manager;
        this.windowButtons = [];
        this.favoritesButtons = [];
        
        this.widget = new St.BoxLayout({
            x_expand: false,
        });
        this.widget.connect('destroy', this._onWidgetDestroyed.bind(this));

        this.windowButtonsContainer = new St.BoxLayout({
            style_class: 'window-list-container',
            x_expand: false,
        });
        
        this.favoritesContainer = new St.BoxLayout({
            style_class: 'favorites-container',
            x_expand: false,
        });
        
        this.widget.add_child(this.favoritesContainer);
        this.widget.add_child(this.windowButtonsContainer);

        panel._leftBox.insert_child_at_index(this.widget, -1);

        AppFavorites.getAppFavorites().connectObject(
            'changed',
            this._recreateFavorites.bind(this),
            this,
        );
        
        this._createFavorites();
        
        // Connect to the window list manager which will tell us about windows being
        // added, removed, and reordered in the window list order:
        this.manager.events.connectObject(
            'window-appended',
            this._onWindowAppended.bind(this),
            'window-removed',
            this._onWindowRemoved.bind(this),
            'window-moved',
            this._onWindowMoved.bind(this),
            this,
        );

        this._dragInProgress = false;
        this._draggedButton = null;
        this._dragTimeoutId = 0;
    }

    _onWindowAppended(window) {
        const button = new WindowButton(window, this.panel.monitor.index);
        button.button.connect('scroll-event', this._onScrollEvent.bind(this));
        button.button.connect('button-press-event', this._onButtonPress.bind(this));
        button.button.connect('leave-event', this._onButtonLeave.bind(this));
        button.button.connect('enter-event', this._onButtonEnter.bind(this));
        this.windowButtonsContainer.add_child(button.button);
        this.windowButtons.push(button);
    }

    _onWindowRemoved(index) {
        let button = this.windowButtons[index]
        button.destroy();
        this.windowButtons.splice(index, 1);
    }

    _onWindowMoved(src_index, dst_index) {
        let button = this.windowButtons[src_index]
        this.windowButtonsContainer.set_child_at_index(button.button, dst_index);
        this.windowButtons.splice(src_index, 1);
        this.windowButtons.splice(dst_index, 0, button);
    }
    
    _onScrollEvent(actor, event) {
        let direction = event.get_scroll_direction();
        if (direction === 0) {
            this._focusPreviousWindow();
        } else if (direction === 1) {
            this._focusNextWindow();
        }
        return true;
    }

    _focusNextWindow() {
        let visibleButtons = this.windowButtons.filter(btn => btn.button.visible);
        if (visibleButtons.length === 0) return;

        let currentIndex = visibleButtons.findIndex(btn => btn._isFocused());
        
        if (currentIndex === -1) {
            visibleButtons[0].window.activate(global.get_current_time());
            return;
        }
        
        if (currentIndex >= visibleButtons.length - 1) return;
        
        visibleButtons[currentIndex + 1].window.activate(global.get_current_time());
    }

    _focusPreviousWindow() {
        let visibleButtons = this.windowButtons.filter(btn => btn.button.visible);
        if (visibleButtons.length === 0) return;

        let currentIndex = visibleButtons.findIndex(btn => btn._isFocused());
        
        if (currentIndex === -1) {
            visibleButtons[visibleButtons.length - 1].window.activate(global.get_current_time());
            return;
        }
        
        if (currentIndex <= 0) return;
        
        visibleButtons[currentIndex - 1].window.activate(global.get_current_time());
    }

    _leftMouseButtonIsDown() {
        let [, , modifierMask] = global.get_pointer();
        return !!(modifierMask & Clutter.ModifierType.BUTTON1_MASK);
    }

    _onButtonPress(actor, event) {
        if (this._dragInProgress) {
            this._endDrag();
        }
    }

    _onButtonEnter(actor, event) {
        if (this._dragInProgress) {
            this._onDragTimeout();
        }
        return false;
    }

    _onButtonLeave(actor, event) {
        if (this._leftMouseButtonIsDown() && !this._dragInProgress) {
            let button = this.windowButtons.find(btn => btn.button === actor);
            if (button) {
                this._dragInProgress = true;
                this._draggedButton = button;
                this._draggedButton.setDragging(true);
                this._dragTimeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    DRAG_TIMEOUT_INTERVAL_MS,
                    this._onDragTimeout.bind(this),
                )
            }
        }
        return false;
    }

    _onDragTimeout() {
        if (!this._leftMouseButtonIsDown()) {
            this._endDrag();
            return;
        }
        
        if (!this.windowButtons.includes(this._draggedButton) || !this._draggedButton.button.visible) {
            this._endDrag();
            return;
        }

        let [x, y] = global.get_pointer();

        let [containerX, containerY] = this.windowButtonsContainer.get_transformed_position();
        let relativeX = x - containerX;
        
        let targetButton = this._getButtonAtPosition(relativeX);
        
        if (targetButton && targetButton !== this._draggedButton) {
            // Reorder the buttons:
            let src_index = this.windowButtonsContainer.get_children().indexOf(this._draggedButton.button);
            let dst_index = this.windowButtonsContainer.get_children().indexOf(targetButton.button);
            this.manager.moveWindow(src_index, dst_index);
        }
        return GLib.SOURCE_CONTINUE;
    }

    _getButtonAtPosition(x) {
        if (x >= this.windowButtonsContainer.width) {
            let visibleButtons = this.windowButtons.filter(btn => btn.button.visible);
            return visibleButtons[visibleButtons.length - 1];
        } else if (x <= 0) {
            let visibleButtons = this.windowButtons.filter(btn => btn.button.visible);
            return visibleButtons[0];
        }

        for (let button of this.windowButtons) {
            if (!button.button.visible) continue;
            
            let [buttonX, buttonY] = button.button.get_position();
            let buttonWidth = button.button.width;
            
            if (x >= buttonX && x <= buttonX + buttonWidth) {
                return button;
            }
        }
        throw new Error("_getButtonAtPosition(): no button found");
    }

    _endDrag() {
        if (this._draggedButton) {
            this._draggedButton.setDragging(false);
        }

        this._dragInProgress = false;
        this._draggedButton = null;
        
        if (this._dragTimeoutId) {
            GLib.source_remove(this._dragTimeoutId);
            this._dragTimeoutId = 0;
        }
    }

    _createFavorites() {
        let favorites = AppFavorites.getAppFavorites().getFavorites();
        favorites.forEach(app => {
            let button = new FavoritesButton(app, this.favoritesContainer);
            this.favoritesButtons.push(button);
        });
    }

    _destroyFavorites() {
        this.favoritesButtons.forEach(button => {
            button.destroy();
        });
        this.favoritesButtons = [];
    }

    _recreateFavorites() {
        this._destroyFavorites();
        this._createFavorites();
    }

    _onWidgetDestroyed() {
        this.widget = null;
    }

    destroy() {
        AppFavorites.getAppFavorites().disconnectObject(this);
        this.manager.disconnectObject(this);
        this._endDrag();
        
        this._destroyFavorites();
        
        this.windowButtons.forEach(button => {
            button.destroy();
        });
        this.windowButtons = [];
        
        if (this.widget) {
            this.widget.destroy();
        }
    }
}
