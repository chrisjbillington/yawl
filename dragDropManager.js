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
    constructor() {
      this._state = DRAG_IDLE;
      this._draggedWidget = null;
      this._timeoutId = 0;
      this.events = new EventEmitter();
    }
    
    registerWidget(widget) {
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
                this._draggedWidget = widget;
                this._state = DRAG_ARMED;
                break;
            case DRAG_ARMED:
                // Nothing to do
                break;
            case DRAG_ACTIVE:
                // This implies there was a mouse release that our timeout callback
                // missed. End the drag and arm a new one, which is what would have
                // happened had we detected it with the callback.
                this._endDrag();
                this._draggedWidget = widget;
                this._state = DRAG_ARMED;
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
                this._draggedWidget = null;
                this._state = DRAG_IDLE;
                break;
            case DRAG_ACTIVE:
                // End
                this._endDrag();
                this._state = DRAG_IDLE;
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
                this._beginDrag();
                this._state = DRAG_ACTIVE;
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
                // Send an immediate update event to the group owner so that it can
                // reorder widgets as needed without waiting for the timeout to fire, to
                // avoid flickering caused by e.g. hover style taking effect first
                const [x, y] = getMouseState();
                this.events.emit('drag-update', this._draggedWidget, x, y);
                break;
            default:
                throw new Error(`invalid drag state ${this._state}`);
        }
        // Explicitly returning false to acknowledge events will progagate is compulsory
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
                this._draggedWidget = null;
                this._state = DRAG_IDLE;
                break;
            case DRAG_ACTIVE:
                // Cancel
                this._endDrag();
                this._state = DRAG_IDLE;
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
                this._draggedWidget = null;
                this._state = DRAG_IDLE;
            case DRAG_ACTIVE:
                // Cancel
                this._endDrag();
                this._state = DRAG_IDLE;
                break;
            default:
                throw new Error(`invalid drag state ${this._state}`);
        }
        // Clean up our connections:
        widget.disconnectObject(this);
    }

    _beginDrag() {
        // console.log("DragDropManager._beginDrag()");
        if (this._state === DRAG_ACTIVE) {
            throw new Error("Drag already active");
        }
        this._timeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            DRAG_TIMEOUT_INTERVAL_MS,
            this._onDragTimeout.bind(this),
        )
        const [x, y] = getMouseState();
        this.events.emit('drag-started', this._draggedWidget, x, y);
    }

    _onDragTimeout() {
        // console.log("DragDropManager._onDragTimeout()");
        if (this._state !== DRAG_ACTIVE) {
            throw new Error("Drag not active");
        }
        const [x, y, pressed] = getMouseState();
        if (!pressed) {
            this._endDrag();
            this._state = DRAG_IDLE;
            return;
        }
        this.events.emit('drag-update', this._draggedWidget, x, y);
        return GLib.SOURCE_CONTINUE;
    }

    _endDrag() {
        // console.log("DragDropManager._endDrag()");
        if (this._state !== DRAG_ACTIVE) {
            throw new Error("Drag not active");
        }        
        // Stop timeout:
        GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;

        // Send end event to group owner:
        const [x, y] = getMouseState();
        this.events.emit('drag-ended', this._draggedWidget, x, y);
        this._draggedWidget = null;
    }

    destroy() {
        // console.log("DragDropManager.destroy()");
        if (this._state === DRAG_ACTIVE) {
            this._endDrag();
        }
    }
}
