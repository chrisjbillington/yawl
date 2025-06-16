import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';

const TOOLTIP_HOVER_TIMEOUT_MS = 300;

export class ToolTip {
    constructor() {
        this._widget = new St.Label({
            style_class: 'panel-window-list-tooltip'
        });
        
        // Add to UI but keep hidden initially
        Main.uiGroup.add_child(this._widget);
        this._widget.hide();
        
        this._timeoutId = 0;
        this._targetWidget = null;
        this._lastHideTime = 0;
    }

    show(widget, text) {
        // If we're already showing for this widget with same text, do nothing
        if (this._targetWidget === widget && this._widget.text === text && this._widget.visible) {
            return;
        }
        // Validate text to prevent null/undefined issues
        if (!text || typeof text !== 'string') {
            return;
        }
        this._targetWidget = widget;
        this._widget.text = text;
        this._setTimeout();
    }

    _setTimeout() {
        // Check if we should show immediately (within grace period of last hide)
        this._cancelTimeout();
        const immediate = (Date.now() - this._lastHideTime) < TOOLTIP_HOVER_TIMEOUT_MS;
        const delay = immediate ? 0 : TOOLTIP_HOVER_TIMEOUT_MS;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._timeoutId = 0;
            this._show();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelTimeout() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    _show() {
        if (!this._targetWidget || !this._targetWidget.get_stage()) {
            return;
        }
        this._widget.show();
        this._position();
    }

    hide() {
        this._cancelTimeout();
        if (this._widget.visible) {
            this._widget.hide();
            this._lastHideTime = Date.now();
            this._targetWidget = null;
        }
    }

    inhibit() {
        // Hide and reset grace period:
        this.hide();
        this._lastHideTime = 0;
    }

    _position() {
        if (!this._widget || !this._targetWidget || !this._targetWidget.get_stage()) {
            return;
        }

        let [stageX, stageY] = this._targetWidget.get_transformed_position();
        let widgetWidth = this._targetWidget.width;
        let widgetHeight = this._targetWidget.height;
        
        // Ensure tooltip is properly laid out before getting its size
        this._widget.get_preferred_width(-1);
        this._widget.get_preferred_height(-1);
        
        let tooltipWidth = this._widget.width;
        let tooltipHeight = this._widget.height;

        // Default positioning: left-align tooltip, show above widget
        let x = stageX;
        let y = stageY - tooltipHeight - 5;

        // Keep tooltip within screen bounds
        let monitor = Main.layoutManager.findMonitorForActor(this._targetWidget);
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

        this._widget.set_position(Math.round(x), Math.round(y));
    }

    destroy() {
        this._cancelTimeout();
        if (this._widget) {
            this._widget.destroy();
            this._widget = null;
        }
        this._targetWidget = null;
    }
}
