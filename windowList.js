import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Mtk from 'gi://Mtk';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js'
import {WindowButton} from './windowButton.js';
import {FavoritesButton} from './favoritesButton.js';
import {DragDropManager} from './dragDropManager.js';

const SCROLL_WHEEL_UP = 0;
const SCROLL_WHEEL_DOWN = 1;

function getWindowId(window) {
    // We use mutter's stable sequence numbers to identify windows
    return window.get_stable_sequence();
}


function _getClosestChildIndex(containerWidget, x) {
    // Return the index of the visible child widget of containerWidget that is
    // horizontally closest to the given x position, or -1 if there are no visible child
    // widgets

    const [x0, y0] = containerWidget.get_transformed_position();
    const xrel = x - x0;
    let best_index = -1;
    let best_distance = Infinity;
    
    containerWidget.get_children().forEach((child, index) => {
        if (child.visible) {
            const [child_left, _] =  child.get_position();
            const child_right = child_left + child.width;
            let distance;
            if (xrel < child_left) {
                distance = child_left - xrel;
            } else if (xrel > child_right) {
                distance = xrel - child_right;
            } else {
                distance = 0;
            }
            if (distance < best_distance) {
                best_distance = distance;
                best_index = index;
            }
        }
    });

    return best_index;
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

    constructor(settings) {
        this.events = new EventEmitter();
        this.settings = settings;
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
        const savedWindowIDs = this.settings.get_value('window-order').deep_unpack();
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

    transferDragToMonitor(src_index, monitor_index) {
        const window = this._windows[src_index];
        window.move_to_monitor(monitor_index);
        this.events.emit('drag-transferred-to-monitor', src_index, monitor_index);
    }

    destroy() {
        // Save window order to gsettings:
        const order = this._windows.map(window => getWindowId(window));
        this.settings.set_value('window-order', new GLib.Variant('ai', order));

        // Disconnect signals
        global.display.disconnectObject(this);
        this._windows.forEach(window => {
            window.disconnectObject(this);
        });
    }
}


export class WindowList {
    constructor(panel, manager) {
        this.panel = panel;
        this.manager = manager;
        this._windowButtons = [];
        this.favoritesButtons = [];
        
        this.widget = new St.BoxLayout({
            x_expand: false,
        });
        this.widget.connect('destroy', this._onWidgetDestroyed.bind(this));

        this._windowButtonsContainer = new St.BoxLayout({
            style_class: 'window-list-container',
            x_expand: false,
        });
        
        this.favoritesContainer = new St.BoxLayout({
            style_class: 'favorites-container',
            x_expand: false,
        });
        
        this.widget.add_child(this.favoritesContainer);
        this.widget.add_child(this._windowButtonsContainer);

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
            'drag-transferred-to-monitor',
            this._onDragTransferredToMonitor.bind(this),
            this,
        );

        this._dragDropManager = new DragDropManager();

        this._dragDropManager.events.connectObject(
            'drag-started',
            this._onDragStarted.bind(this),
            'drag-update',
            this._onDragUpdate.bind(this),
            'drag-ended',
            this._onDragEnded.bind(this),
        )
    }

    _onWindowAppended(emitter, window) {
        const button = new WindowButton(window, this.panel.monitor.index);
        button.button.connect('scroll-event', this._onScrollEvent.bind(this));
        this._windowButtonsContainer.add_child(button.button);
        this._windowButtons.push(button);
        this._dragDropManager.registerWidget(button.button);
    }

    _onWindowRemoved(emitter, index) {
        let button = this._windowButtons[index]
        button.destroy();
        this._windowButtons.splice(index, 1);
    }

    _onWindowMoved(emitter, src_index, dst_index) {
        let button = this._windowButtons[src_index]
        this._windowButtonsContainer.set_child_at_index(button.button, dst_index);
        this._windowButtons.splice(src_index, 1);
        this._windowButtons.splice(dst_index, 0, button);
    }

    _onDragTransferredToMonitor(emitted, src_index, monitor_index) {
        // console.log(`WindowList._onDragTransferredToMonitor() monitor ${this.panel.monitor.index}`);
        if (monitor_index === this.panel.monitor.index) {
            this._dragDropManager.startDrag(this._windowButtons[src_index].button)
        }
    }

    _onScrollEvent(actor, event) {
        let direction = event.get_scroll_direction();
        if (direction === SCROLL_WHEEL_UP) {
            this._focusPreviousWindow();
        } else if (direction === SCROLL_WHEEL_DOWN) {
            this._focusNextWindow();
        }
        return true;
    }

    _focusNextWindow() {
        let visibleButtons = this._windowButtons.filter(btn => btn.button.visible);
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
        let visibleButtons = this._windowButtons.filter(btn => btn.button.visible);
        if (visibleButtons.length === 0) return;

        let currentIndex = visibleButtons.findIndex(btn => btn._isFocused());
        
        if (currentIndex === -1) {
            visibleButtons[visibleButtons.length - 1].window.activate(global.get_current_time());
            return;
        }
        
        if (currentIndex <= 0) return;
        
        visibleButtons[currentIndex - 1].window.activate(global.get_current_time());
    }

    _onDragStarted(emitter, widget, x, y) {
        // console.log(`WindowList._onDragStarted() monitor ${this.panel.monitor.index}`);
        const index = this._windowButtonsContainer.get_children().indexOf(widget);
        const button = this._windowButtons[index]
        button.setDragging(true);
        // Ensure we render any initial button movement right away to avoid flicker:
        this._onDragUpdate(emitter, widget, x, y);
    }

    _onDragUpdate(emitter, widget, x, y) {
        // console.log(`WindowList._onDragUpdate() monitor ${this.panel.monitor.index}`);
        const src_index = this._windowButtonsContainer.get_children().indexOf(widget);
        const rect = new Mtk.Rectangle({x, y, width: 1, height: 1});
        const monitor_index = global.display.get_monitor_index_for_rect(rect);
        if (monitor_index !== this.panel.monitor.index) {
            // Cancel the drag operation and transfer it to another monitor:
            this._dragDropManager.endDrag();
            this.manager.transferDragToMonitor(src_index, monitor_index)
        } else {
            // Move the dragged window button to the location closest to the cursor:
            const dst_index = _getClosestChildIndex(this._windowButtonsContainer, x);
            if (dst_index !== -1 && dst_index !== src_index) {
                this.manager.moveWindow(src_index, dst_index);
            }
        }
    }

    _onDragEnded(emitter, widget, x, y) {
        // console.log(`WindowList._onDragEnded() monitor ${this.panel.monitor.index}`);
        const index = this._windowButtonsContainer.get_children().indexOf(widget);
        const button = this._windowButtons[index]
        button.setDragging(false);
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
        this.manager.events.disconnectObject(this);
        
        this._destroyFavorites();
        
        this._windowButtons.forEach(button => {
            button.destroy();
        });
        this._windowButtons = [];
        
        if (this.widget) {
            this.widget.destroy();
        }

        this._dragDropManager.destroy();
    }
}
