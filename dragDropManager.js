import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js'

const MOUSE_BUTTON_LEFT = 1;

const DRAG_IDLE = 0;
const DRAG_ARMED = 1;
const DRAG_ACTIVE = 2;

const DRAG_TIMEOUT_INTERVAL_MS = 50;


function getMouseState() {
    // Return x and y mouse coords and whether left mouse button is pressed
    const [x, y, modifierMask] = global.get_pointer();
    const pressed =  !!(modifierMask & Clutter.ModifierType.BUTTON1_MASK);
    return [x, y, pressed];
}


export class DragDropManager {
    // Class to manage drag-drop operations for widgets registered with it. Callers
    // should call registerWidget() with the widgets that are drag-droppable within a
    // group (unrelated groups of widgets should use separate DragDropManagers). Then
    // callers should connect to the following signals emitted by
    // DragDropManager.events:
    //
    // - drag-started (widget, x, y): the given widget has started a drag operation, the
    //   mouse is currently at coordinates x,y.
    //
    // - drag-update (widget, x, y): emitted every 50ms whilst a drag is in progress,
    //   with the widget being dragged, and the current mouse coordinates.
    //
    // - drag-ended (widget, x, y): emitted when a drag operation has completed. This
    //   event will be immediately preceded by a drag-update event with the same x,y
    //   coordinates, so there is no need to duplicate updates related to mouse movement
    //   if they are already performed in the handler for drag-update.
    //
    // Callers may end a drag operation at any time by calling endDrag(), which will end
    // the drag operation and emit a final drag-update and drag-ended. Calling endDrag()
    // from within a handler to dragUpdate() is safe, drag-update handlers will not be
    // called re-entrantly.
    //
    // Callers may initiate a drag by calling startDrag(widget) (widget must have been
    // previously registered, this is not checked). The drag will end immediately if
    // the left mouse button is not held, so this only makes sense when the left mouse
    // button is already held.

    constructor() {
        // console.log("DragDropManager.constructor()");
        this._state = DRAG_IDLE;
        this._draggedWidget = null;
        this._timeoutId = 0;
        this._update_running = false;
        this.events = new EventEmitter();
    }
    
    _setState(state, draggedWidget) {
        // State must always be set along with the dragged widget (null if state is
        // DRAG_IDLE)
        this._state = state;
        this._draggedWidget = draggedWidget;
    }

    registerWidget(widget) {
        // console.log("DragDropManager.registerWidget()");
        widget.connectObject(
            'button-press-event',
            this._onButtonPress.bind(this),
            'button-release-event',
            this._onButtonRelease.bind(this),
            'leave-event',
            this._onLeaveEvent.bind(this),
            'enter-event',
            this._onEnterEvent.bind(this),
            'notify::visible',
            this._onVisibleChanged.bind(this),
            'destroy',
            this._onWidgetDestroyed.bind(this),
        );
    }

    startDrag(widget) {
        // console.log("DragDropManager.startDrag()");
        if (this._state === DRAG_ACTIVE) {
            throw new Error("Drag already active");
        }
        this._setState(DRAG_ACTIVE, widget);
        this._startDrag();
    }

    _startDrag() {
        // console.log("DragDropManager._startDrag()");
        this._timeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            DRAG_TIMEOUT_INTERVAL_MS,
            this._onDragTimeout.bind(this),
        )
        const [x, y] = getMouseState();
        this.events.emit('drag-started', this._draggedWidget, x, y);
    }

    endDrag() {
        // console.log("DragDropManager.endDrag()");
        if (this._state === DRAG_ACTIVE) {
            // Set idle drag state state before emitting to avoid re-entrancy if update
            // callbacks call endDrag():
            const widget = this._draggedWidget;
            this._setState(DRAG_IDLE, null);
            this._endDrag(widget);
        }
    }

    _endDrag(widget) {
        // console.log("DragDropManager._endDrag()");
        // Stop timeout:
        GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
        const [x, y] = getMouseState();
        this._emitDragUpdate(widget, x, y)
        this.events.emit('drag-ended', widget, x, y);
    }

    _emitDragUpdate(widget, x, y) {
        // Avoid re-entrancy:
        if (!this._update_running) {
            this._update_running = true;
            this.events.emit('drag-update', widget, x, y);
            this._update_running = false;
        }
    }

    _onButtonPress(widget, event) {
        // console.log("DragDropManager._onButtonPress()");
        let button = event.get_button();
        if (button !== MOUSE_BUTTON_LEFT) {
            return;
        }
        switch (this._state) {
            case DRAG_IDLE:
                // Drag is now "armed" for this widget such that a subsequent leave
                // event starts a drag
                this._setState(DRAG_ARMED, widget);
                break;
            case DRAG_ARMED:
                // Nothing to do
                break;
            case DRAG_ACTIVE:
                // This implies there was a mouse release that our timeout callback
                // missed. End the drag and arm a new one, which is what would have
                // happened had we detected it with the callback.
                this.endDrag();
                this._setState(DRAG_ARMED, widget);
                break;
            default:
                throw new Error(`invalid drag state ${this._state}`);
        }
    }

    _onButtonRelease(widget, event) {
        // console.log("DragDropManager._onButtonRelease()");
        let button = event.get_button();
        if (button !== MOUSE_BUTTON_LEFT) {
            return;
        }
        switch (this._state) {
            case DRAG_IDLE:
                // nothing to do
                break;
            case DRAG_ARMED:
                // Disarm
                this._setState(DRAG_IDLE, null);
                break;
            case DRAG_ACTIVE:
                // End
                this.endDrag();
                break;
            default:
                throw new Error(`invalid drag state ${this._state}`);
        }
    }

    _onLeaveEvent(widget) {
        // console.log("DragDropManager._onLeaveEvent()");
        switch (this._state) {
            case DRAG_IDLE:
                // Nothing to do
                break;
            case DRAG_ARMED:
                // If mouse leaves whilst left mouse button is pressed (implied by ARMED
                // state), start a drag operation:
                if (widget === this._draggedWidget) {
                    this.startDrag(widget);
                } else {
                    // Disarm - this shouldn't happen:
                    this._setState(DRAG_IDLE, null);
                }
                break;
            case DRAG_ACTIVE:
                // Nothing to do
                break;
            default:
                throw new Error(`invalid drag state ${this._state}`);
        }
        // Explicitly returning false to acknowledge events will progagate is compulsory
        // for leave and enter events:
        return false;
    }

    _onEnterEvent(widget) {
        // console.log("DragDropManager._onEnterEvent()");
        switch (this._state) {
            case DRAG_IDLE:
            case DRAG_ARMED:
                // Nothing to do
                break;
            case DRAG_ACTIVE:
                // Send an immediate update event so parent can reorder widgets as
                // needed without waiting for the timeout to fire, to avoid flickering
                // caused by e.g. hover style taking effect first
                const [x, y] = getMouseState();
                this._emitDragUpdate(this._draggedWidget, x, y);
                break;
            default:
                throw new Error(`invalid drag state ${this._state}`);
        }
        // Explicitly returning false to acknowledge events will propagate is compulsory
        // for leave and enter events:
        return false;
    }

    _onVisibleChanged(widget, visible) {
        // console.log("DragDropManager._onVisibleChanged()");
        if (widget !== this._draggedWidget) {
            return;
        }
        switch (this._state) {
            case DRAG_IDLE:
                // Nothing to do
                break;
            case DRAG_ARMED:
                // Disarm
                this._setState(DRAG_IDLE, null);
                break;
            case DRAG_ACTIVE:
                // Cancel
                this.endDrag();
                break;
            default:
                throw new Error(`invalid drag state ${this._state}`);
        }
    }

    _onWidgetDestroyed(widget) {
        // console.log("DragDropManager._onWidgetDestroyed()");
        if (widget !== this._draggedWidget) {
            return;
        }
        switch (this._state) {
            case DRAG_IDLE:
                // Nothing to do
                break;
            case DRAG_ARMED:
                // Disarm
                this._setState(DRAG_IDLE, null);
                break
            case DRAG_ACTIVE:
                // Cancel
                this.endDrag();
                break;
            default:
                throw new Error(`invalid drag state ${this._state}`);
        }
        // Clean up our connections:
        widget.disconnectObject(this);
    }

    _onDragTimeout() {
        // console.log("DragDropManager._onDragTimeout()");
        if (this._state !== DRAG_ACTIVE) {
            throw new Error("Drag not active");
        }
        const [x, y, pressed] = getMouseState();
        if (!pressed) {
            this.endDrag();
            return;
        }
        this._emitDragUpdate(this._draggedWidget, x, y)
        return GLib.SOURCE_CONTINUE;
    }

    destroy() {
        // console.log("DragDropManager.destroy()");
        this.endDrag()
    }
}
