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


function _getMoveIndexForCursorX(container, child, x) {
    // Get the index in `container` that `child` (which must be a child of `container`)
    // should be moved to, based on the position `x`. Returns the index of the visible
    // child widget that is horizontally nearest to `x`, or if `child` isn't visible and
    // `x` is to the right of the rightmost visible child, the index one greater than
    // the rightmost visible child will be returned.

    const [x0, y0] = container.get_transformed_position();
    const xrel = x - x0;
    const n_visible = container.get_children().filter(child => child.visible).length;

    let best_index = -1;
    let best_distance = Infinity;

    container.get_children().forEach((other, index) => {
        if (other.visible) {
            const left =  other.get_x();
            const right = left + other.width - 1;
            let distance;
            if (xrel < left) {
                distance = left - xrel;
            } else if (xrel > right) {
                distance = xrel - right;
            } else {
                distance = 0;
            }
            if (distance < best_distance) {
                best_distance = distance;
                best_index = index;
            }
        }
    });

    // If child becoming visible in the final position would result in it being in the
    // second-final position, even though the x position was to the right of the final
    // visible widget, instead insert it one further to the right.
    if (!child.visible && best_index === n_visible - 1 && best_distance > 0) {
        best_index++;
    }
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
    // - drag-transferred-to-monitor (src_index, monitor_index, x, y): a drag and drop
    //   of a window button has crossed to a different monitor. The window list
    //   corresponding to that monitor should move the (possibly not yet visible, if
    //   windows are isolated by monitor) window button according to the cursor position
    //   (x, y), move the window to its monitor with
    //   button.window.move_to_monitor(monitor_index), then start a drag operation on
    //   it. This order is important to avoid flicker.
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
        if (!(src_index >= 0 && dst_index >= 0 && src_index < this._windows.length && dst_index <= this._windows.length)) {
            throw new Error(`invalid indices ${src_index},${dst_index} (len=${this._windows.length})`);
        };
        const window = this._windows[src_index];
        this._windows.splice(src_index, 1);
        this._windows.splice(dst_index, 0, window);
        this.events.emit('window-moved', src_index, dst_index);
    }

    transferDragToMonitor(src_index, monitor_index, x, y) {
        // console.log(`transferDragToMonitor(): src_index: ${src_index}`);
        this.events.emit('drag-transferred-to-monitor', src_index, monitor_index, x, y);
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


class FavoritesList {
    constructor(monitor_index, tooltip) {
        this._monitor_index = monitor_index;
        this._tooltip = tooltip;
        this.widget = new St.BoxLayout({
            style_class: 'favorites-container',
            x_expand: false,
        });
        this._favoritesButtons = [];

        AppFavorites.getAppFavorites().connectObject(
            'changed',
            // Defer responding to favorites changing until idle, so we are not
            // destroying widgets from possibly inside their own event handlers:
            () => {
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._recreateFavorites();
                    return GLib.SOURCE_REMOVE;
                });
            },
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

        this._createFavorites();
    }

    _createFavorites() {
        // console.log("FavoritesList._createFavorites()");
        let favorites = AppFavorites.getAppFavorites().getFavorites();
        favorites.forEach(app => {
            let button = new FavoritesButton(app, this.widget, this._tooltip);
            this._favoritesButtons.push(button);
            this._dragDropManager.registerWidget(button.button);
        });
    }

    _destroyFavorites() {
        // console.log("FavoritesList._destroyFavorites()");
        this._favoritesButtons.forEach(button => {
            button.destroy();
        });
        this._favoritesButtons = [];
    }

    _recreateFavorites() {
        // console.log(`FavoritesList._recreateFavorites() monitor ${this._monitor_index}`);
        this._dragDropManager.endDrag();
        this._destroyFavorites();
        this._createFavorites();
    }

    _onDragStarted(emitter, widget) {
        // console.log("FavoritesList._onDragStarted()");
        const index = this.widget.get_children().indexOf(widget);
        const button = this._favoritesButtons[index];
        button.setDragging(true);
    }

    _onDragUpdate(emitter, widget, x, y) {
        // console.log("FavoritesList._onDragUpdate()");
        const src_index = this.widget.get_children().indexOf(widget);
        // Move the dragged window button to the location closest to the cursor:
        const dst_index = _getMoveIndexForCursorX(this.widget, widget, x);
        if (dst_index !== -1 && dst_index !== src_index) {
            // Reorder our widgets for visual feedback, but don't update system
            // favourites until the drag has ended:
            let button = this._favoritesButtons[src_index];
            this.widget.set_child_at_index(button.button, dst_index);
            this._favoritesButtons.splice(src_index, 1);
            this._favoritesButtons.splice(dst_index, 0, button);
        }
    }

    _onDragEnded(emitter, widget) {
        // console.log("FavoritesList._onDragEnded()");
        const index = this.widget.get_children().indexOf(widget);
        const button = this._favoritesButtons[index];
        button.setDragging(false);

        // Update system favorites if it moved:
        const appId = button.app.get_id();
        const appFavorites = AppFavorites.getAppFavorites();
        const favorites = appFavorites.getFavorites();
        if (favorites[index] && favorites[index].get_id() !== appId) {
            appFavorites.moveFavoriteToPos(appId, index);
        }
    }

    destroy() {
        // console.log("FavoritesList.destroy()");
        AppFavorites.getAppFavorites().disconnectObject(this);
        this._destroyFavorites();
        this._dragDropManager.destroy();
    }
}


class WindowList {
    constructor(manager, monitor_index, tooltip) {
        this._manager = manager;
        this._monitor_index = monitor_index;
        this._tooltip = tooltip;
        this._windowButtons = [];
        
        this.widget = new St.BoxLayout({
            style_class: 'window-list-container',
            x_expand: false,
        });
        
        // Connect to the window list manager which will tell us about windows being
        // added, removed, and reordered in the window list order:
        this._manager.events.connectObject(
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
        const button = new WindowButton(window, this._monitor_index, this._tooltip);
        button.button.connect('scroll-event', this._onScrollEvent.bind(this));
        this.widget.add_child(button.button);
        this._windowButtons.push(button);
        this._dragDropManager.registerWidget(button.button);
    }

    _onWindowRemoved(emitter, index) {
        let button = this._windowButtons[index];
        button.destroy();
        this._windowButtons.splice(index, 1);
    }

    _onWindowMoved(emitter, src_index, dst_index) {
        let button = this._windowButtons[src_index];
        this.widget.set_child_at_index(button.button, dst_index);
        this._windowButtons.splice(src_index, 1);
        this._windowButtons.splice(dst_index, 0, button);
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

    _onDragStarted(emitter, widget) {
        // console.log(`WindowList._onDragStarted() monitor ${this._monitor_index}`);
        const index = this.widget.get_children().indexOf(widget);
        const button = this._windowButtons[index];
        button.setDragging(true);
    }

    _onDragUpdate(emitter, widget, x, y) {
        // console.log(`WindowList._onDragUpdate() monitor ${this._monitor_index}`);
        const src_index = this.widget.get_children().indexOf(widget);
        const rect = new Mtk.Rectangle({x, y, width: 1, height: 1});
        const monitor_index = global.display.get_monitor_index_for_rect(rect);
        if (monitor_index !== this._monitor_index) {
            // Cancel the drag operation and transfer it to another monitor:
            this._dragDropManager.endDrag();
            this._manager.transferDragToMonitor(src_index, monitor_index, x, y)
        } else {
            // Move the dragged window button to the location closest to the cursor:
            const dst_index = _getMoveIndexForCursorX(this.widget, widget, x);
            if (dst_index !== src_index) {
                this._manager.moveWindow(src_index, dst_index);
            }
        }
    }

    _onDragTransferredToMonitor(emitter, src_index, monitor_index, x, y) {
        // console.log(`WindowList._onDragTransferredToMonitor() monitor ${this._monitor_index}`);
        if (monitor_index === this._monitor_index) {
            const button = this._windowButtons[src_index];
            // Move the dragged window button to the location closest to the cursor:
            const dst_index = _getMoveIndexForCursorX(this.widget, button.button, x);
            if (dst_index !== src_index) {
                this._manager.moveWindow(src_index, dst_index);
            }
            button.window.move_to_monitor(monitor_index);
            this._dragDropManager.startDrag(button.button)
        }
    }

    _onDragEnded(emitter, widget) {
        // console.log(`WindowList._onDragEnded() monitor ${this._monitor_index}`);
        const index = this.widget.get_children().indexOf(widget);
        const button = this._windowButtons[index];
        button.setDragging(false);
    }

    destroy() {
        this._manager.events.disconnectObject(this);
        this._windowButtons.forEach(button => {
            button.destroy();
        });
        this._windowButtons = [];
        this._dragDropManager.destroy();
    }
}


export class Panel {
    constructor(panel, windowListManager, tooltip) {
        this._monitor_index = panel.monitor.index;
        this.widget = new St.BoxLayout({
            style_class: 'panel',
            x_expand: false,
        });
        this.widget.connect('destroy', this._onWidgetDestroyed.bind(this));

        this._favoritesList = new FavoritesList(this._monitor_index, tooltip);
        this._windowList = new WindowList(windowListManager, this._monitor_index, tooltip);
        
        this.widget.add_child(this._favoritesList.widget);
        this.widget.add_child(this._windowList.widget);

        panel._leftBox.insert_child_at_index(this.widget, -1);
    }

    _onWidgetDestroyed() {
        this.widget = null;
    }

    destroy() {
        this._favoritesList.destroy();
        this._windowList.destroy();
        if (this.widget) {
            this.widget.destroy();
        }
    }
}
