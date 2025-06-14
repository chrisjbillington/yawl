import St from 'gi://St';
import Shell from 'gi://Shell';
import Mtk from 'gi://Mtk';

const ISOLATE_MONITORS = true;
const ISOLATE_WORKSPACES = true;
const ICON_SIZE = 18;
const MINIMIZED_ALPHA = 0.5;

export class WindowButton {
    constructor(window, monitor_index) {
        this.window = window;
        this.monitor_index = monitor_index;
        
        this.button = new St.Button({
            style_class: 'window-button',
        });

        this._hbox = new St.BoxLayout({
            style_class: 'window-button-content',
        });

        this._icon = new St.Bin({});

        this._label = new St.Label({
            style_class: 'window-button-label',
        });
        
        this._hbox.add_child(this._icon);
        this._hbox.add_child(this._label);
        this.button.set_child(this._hbox);

        this.button.connect('destroy', this._onButtonDestroyed.bind(this));
        this.button.connect('clicked', this._onButtonClicked.bind(this));
        this.button.connect('button-press-event', this._onButtonPress.bind(this));

        global.display.connectObject(
            'notify::focus-window',
            this._updateStyle.bind(this),
            'window-entered-monitor',
            this.updateVisibility.bind(this),
            'window-left-monitor',
            this.updateVisibility.bind(this),
            this,
        );
        global.window_manager.connectObject(
            'switch-workspace',
            this.updateVisibility.bind(this),
            this,
        )

        this.window.connectObject(
            'workspace-changed',
            this.updateVisibility.bind(this),
            'notify::skip-taskbar',
            this.updateVisibility.bind(this),
            'notify::title',
            this._updateTitle.bind(this),
            'notify::wm-class',
            this._updateIcon.bind(this),
            'notify::gtk-application-id',
            this._updateIcon.bind(this),
            'notify::minimized',
            this._updateMinimized.bind(this),
            'notify::demands-attention',
            this._updateStyle.bind(this),
            'notify::urgent',
            this._updateStyle.bind(this),
            this,
        )
        
        this._updateTitle();
        this._updateIcon();
        this.updateVisibility();
        this._updateMinimized();
        this._updateStyle();
    }
    
    updateVisibility() {
        if (this.button) {
            let workspace = global.workspace_manager.get_active_workspace();
            let visible = !this.window.skip_taskbar &&
                   (!ISOLATE_WORKSPACES || this.window.located_on_workspace(workspace)) &&
                   (!ISOLATE_MONITORS || this.window.get_monitor() === this.monitor_index);
            this.button.visible = visible;
        }
    }

    _updateTitle() {
        if (this.button) {
            this._label.text = this.window.get_title() || '';
        }
    }

    _updateIcon() {
        if (this.button) {
            let app = Shell.WindowTracker.get_default().get_window_app(this.window);
            if (app) {
                this._icon.child = app.create_icon_texture(ICON_SIZE);
            } else {
                this._icon.child = new St.Icon({
                    icon_name: 'application-x-executable',
                    icon_size: ICON_SIZE,
                });
            }
        }
    }

    _updateMinimized() {
        this._updateIconGeometry();
        if (this.button) {
            let alpha = this.window.minimized ? MINIMIZED_ALPHA : 1.0;
            this._icon.opacity = alpha * 255;
            this._label.opacity = alpha * 255;
        }
    }

    _updateStyle() {
        if (!this.button) return;
        
        this.button.remove_style_class_name('focused');
        this.button.remove_style_class_name('urgent');
        
        if (this.window.demands_attention || this.window.urgent) {
            this.button.add_style_class_name('urgent');
        }
        if (this._isFocused()) {
            this.button.add_style_class_name('focused');
        }
        this.button.sync_hover();
    }
    
    setDragging(isDragging) {
        if (!this.button) return;
        if (isDragging) {
            this.button.add_style_class_name('dragging');
        } else {
            this.button.remove_style_class_name('dragging');
            this.button.fake_release();
        }
        this._updateStyle();
    }

    _isFocused() {
        let focusedWindow = global.display.focus_window;

        while (focusedWindow && focusedWindow.skip_taskbar) {
            focusedWindow = focusedWindow.get_transient_for();
        }
        return focusedWindow === this.window;
    }

    _updateIconGeometry() {
        if (this.button && this.button.visible && this.button.get_stage()) {
            let rect = new Mtk.Rectangle();
            [rect.x, rect.y] = this.button.get_transformed_position();
            [rect.width, rect.height] = this.button.get_transformed_size();
            this.window.set_icon_geometry(rect);   
        }
    }

    _onButtonPress(actor, event) {
        let button = event.get_button();
        if (button === 2) {
            this.window.delete(global.get_current_time());
            return true;
        }
        return false;
    }

    _onButtonClicked() {
        if (this._isFocused()) {
            this.window.minimize();
        } else {
            this.window.activate(global.get_current_time());
        }
    }

    _onButtonDestroyed() {
        this.button = null;
    }

    destroy() {
        if (this.button) {
            this.button.destroy();
        }
        this.window.set_icon_geometry(null);
        this.window.disconnectObject(this);
        global.display.disconnectObject(this);
        global.window_manager.disconnectObject(this);
    }
}
