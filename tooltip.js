import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

const TOOLTIP_HOVER_DELAY_MS = 300;

const ANY_MOUSE_BUTTON_MASK = (
    Clutter.ModifierType.BUTTON1_MASK
    | Clutter.ModifierType.BUTTON2_MASK
    | Clutter.ModifierType.BUTTON3_MASK
    | Clutter.ModifierType.BUTTON4_MASK
    | Clutter.ModifierType.BUTTON5_MASK
)

function getMouseButtonsHeld() {
    // whether any mouse buttons are pressed
    const [x, y, modifierMask] = global.get_pointer();
    return !!(modifierMask & ANY_MOUSE_BUTTON_MASK);
}

export class ToolTip {
    constructor() {
        this._tooltip = new St.Label({
            style_class: 'tooltip'
        });
        
        // Add to UI but keep hidden initially
        Main.uiGroup.add_child(this._tooltip);
        this._tooltip.hide();
        this._text_by_widget = new Map();
        this._timeoutId = 0;
        this._currentWidget = null;
        this._lastHideTime = 0;
    }

    // Set the tooltip for a widget. Set to null or empty string to clear.
    set(widget, text) {
        // console.log("ToolTip.set()");
        if (!text) {
            this._unregister(widget);
            return;
        }
        if (!this._text_by_widget.has(widget)) {
            this._register(widget);
        }
        this._text_by_widget.set(widget, text);
        if (widget === this._currentWidget && this._tooltip.visible) {
            // update text (hide and show to recalculate positioning if needed)
            this._hide();
            this._show(widget);
        }
    }

    // Inhibit a tooltip from showing until the next hover + TOOLTIP_HOVER_DELAY_MS
    inhibit() {
        // console.log("ToolTip.inhibit()");
        // Hide and reset grace period:
        this._hide();
        this._lastHideTime = 0;
    }

    _register(widget) {
        // console.log("ToolTip._register()");
        // Register all the callbacks
        widget.connectObject(
            'notify::hover',
            this._onHover.bind(this),
            'captured-event',
            this._onCapturedEvent.bind(this),
            'destroy',
            this._onWidgetDestroyed.bind(this),
            this
        );
    }

    _unregister(widget) {
        // console.log("ToolTip._unregister()");
        widget.disconnectObject(this);
        this._text_by_widget.delete(widget);
    }

    _onHover(widget) {
        // console.log("ToolTip._onHover()"); Show (delayed) tooltip on hover if there
        // are no mouse buttons held down (as there would be during a drag and drop for
        // example). Hide on unhover.
        if (widget.hover && !getMouseButtonsHeld()) {
            this._show(widget);
        } else {
            this._hide();
        }
    }

    _onCapturedEvent(widget, event) {
        // console.log("ToolTip._onCapturedEvent()");
        // Inhibit tooltips if the user clicks or scrolls on the widget
        const eventType = event.type();
        if (eventType === Clutter.EventType.BUTTON_PRESS ||
            eventType === Clutter.EventType.SCROLL) {
            this.inhibit();
        }
    }

    _onWidgetDestroyed(widget) {
        // console.log("ToolTip._onWidgetDestroyed()");
        if (widget === this._currentWidget) {
            this._hide();
        }
        this._unregister(widget);
    }

    _show(widget) {
        // console.log("ToolTip._show()");
        this._currentWidget = widget;
        this._tooltip.text = this._text_by_widget.get(widget);
        this._setTimeout();
    }

    _hide() {
        // console.log("ToolTip._hide()");
        this._cancelTimeout();
        if (this._tooltip.visible) {
            this._tooltip.hide();
            this._lastHideTime = Date.now();
            this._currentWidget = null;
        }
    }

    _setTimeout() {
        // console.log("ToolTip._setTimeout()");
        // Check if we should show immediately (within grace period of last hide)
        this._cancelTimeout();
        const immediate = (Date.now() - this._lastHideTime) < TOOLTIP_HOVER_DELAY_MS;
        const delay = immediate ? 0 : TOOLTIP_HOVER_DELAY_MS;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._timeoutId = 0;
            if (this._currentWidget && this._currentWidget.get_stage()) {
                this._tooltip.show();
                this._position();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelTimeout() {
        // console.log("ToolTip._cancelTimeout()");
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    _position() {
        // console.log("ToolTip._position()");
        let [stageX, stageY] = this._currentWidget.get_transformed_position();
        let widgetWidth = this._currentWidget.width;
        let widgetHeight = this._currentWidget.height;
        
        // Ensure tooltip is properly laid out before getting its size
        this._tooltip.get_preferred_width(-1);
        this._tooltip.get_preferred_height(-1);
        
        let tooltipWidth = this._tooltip.width;
        let tooltipHeight = this._tooltip.height;

        // Default positioning: left-align tooltip, show above widget
        let x = stageX;
        let y = stageY - tooltipHeight - 5;

        // Keep tooltip within screen bounds
        let monitor = Main.layoutManager.findMonitorForActor(this._currentWidget);
        if (monitor) {
            let gap = 5;
            
            // Horizontal bounds checking
            if (x < monitor.x + gap) {
                x = monitor.x + gap;
            } else if (x + tooltipWidth > monitor.x + monitor.width - gap) {
                x = monitor.x + monitor.width - tooltipWidth - gap;
            }

            // Vertical bounds checking
            if (y < monitor.y + gap) {
                // If tooltip would be above screen, show below instead
                y = stageY + widgetHeight + 5;
            } else if (y + tooltipHeight > monitor.y + monitor.height - gap) {
                // If tooltip would be below screen, clamp to bottom
                y = monitor.y + monitor.height - tooltipHeight - gap;
            }
        }

        this._tooltip.set_position(Math.round(x), Math.round(y));
    }

    destroy() {
        // console.log("ToolTip.destroy()");
        this._cancelTimeout();
        this._text_by_widget.forEach((text, widget) => {
            this._unregister(widget);
        });
        if (this._tooltip) {
            this._tooltip.destroy();
            this._tooltip = null;
        }
        this._currentWidget = null;
    }
}
