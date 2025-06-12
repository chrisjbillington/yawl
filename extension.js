import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js'
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js'
import Shell from 'gi://Shell';
import St from 'gi://St';

// Feature checklist:
// - [x] Draw icon
// - [x] Update title when it changes
// - [x] Update icon when it changes
// - [ ] Update alert status when it changes
// - [x] Update focus status when it changes
// - [x] Update minimised status when it changes
// - [ ] Click raises or minimises
// - [ ] Right click should get window menu
// - [ ] Middle click close
// - [ ] Scroll raises next window, no periodic boundary
// - [ ] Click and drag reorders
// - [ ] Window demanding attention gets highlighted
// - [x] Lighten on hover over and slightly more on click
// - [x] Dim significantly if minimised
// - [x] lightened if active window
// - [ ] Tooltip is window title
// - [ ] Minimise/restore animation should respect the location of the window list entry
// - [ ] Window order should survive suspend/restore and monitor hotplugging
// - [x] Windows moved to new workspaces/monitors should go to the end of the list
// - [ ] Super tab/Super shift-tab should tab through windows in taskbar order
//   (probably: monitor order then taskbar order)
// - [ ] Window list should not exceed available space in panel - buttons should shrink

// Architecture plan:
// * For each panel, we make a WindowList instance (which will be a class we'll have to
//   implement), which loads all existing windows and watches for new ones. These
//   WindowList instances are totally independent. Each contains an ordered list of all
//   windows regardless of display/workspace/etc, which will be filtered for display
//   later.

const DASH_TO_PANEL_UUID = 'dash-to-panel@jderose9.github.com';

// Settings, later to be put in settings app
const ISOLATE_MONITORS = true;
const ISOLATE_WORKSPACES = true;
const WINDOW_TITLE_WIDTH = 140;
const ICON_SIZE = 18;
const HBOX_PADDING_LEFT = 6;
const HBOX_PADDING_RIGHT = 6;
const ICON_LABEL_SPACING = 6;
const LABEL_FONT_SIZE = 13;
const MINIMIZED_ALPHA = 0.5;
const FOCUSED_BACKGROUND_COLOR = 'rgba(128, 128, 128, 0.33)';

class WindowButton {
    constructor(window, monitor_index) {
        this.window = window;
        this.windowId = window.get_id();
        this.monitor_index = monitor_index;
        
        this.button = new St.Button({
            style_class: 'panel-button',
            style: 'border-width: 1px; border-radius: 0px; transition-duration: 0s;',
        });

        this.hbox = new St.BoxLayout({
            style: `padding-left: ${HBOX_PADDING_LEFT}px; padding-right: ${HBOX_PADDING_RIGHT}px; spacing: ${ICON_LABEL_SPACING}px;`,
        });

        this.icon = new St.Bin({});

        this.label = new St.Label({
            style: `font-size: ${LABEL_FONT_SIZE}px;`,
            width: WINDOW_TITLE_WIDTH,
        });

        this.hbox.add_child(this.icon);
        this.hbox.add_child(this.label);
        this.button.set_child(this.hbox);

        this.button.connect('destroy', this._onButtonDestroyed.bind(this));

        // Monitor global focus changes
        global.display.connectObject(
            'notify::focus-window',
            this._updateFocus.bind(this),
            this,
        );

        this.window.connectObject(
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
            this._updateDemandsAttention.bind(this),
            'notify::urgent',
            this._updateDemandsAttention.bind(this),
            this,
        )
        
        this._updateTitle();
        this._updateIcon();
        this.updateVisibility();
        this._updateMinimized();
        this._updateFocus();

        console.log(`WindowButton created for: ${this.window.get_title()}`);
    }
    
    updateVisibility() {
        console.log("WindowButton.updateVisibility() called");
        if (this.button) {
            let workspace = global.workspace_manager.get_active_workspace();
            let visible = !this.window.skip_taskbar &&
                   (!ISOLATE_WORKSPACES || this.window.located_on_workspace(workspace)) &&
                   (!ISOLATE_MONITORS || this.window.get_monitor() === this.monitor_index);
            this.button.visible = visible;
        }
    }

    _updateTitle() {
        console.log("WindowButton._updateTitle() called");
        if (this.button) {
            this.label.text = this.window.get_title() || '';
        }
    }

    _updateIcon() {
        console.log("WindowButton._updateIcon() called");
        if (this.button) {
            let app = Shell.WindowTracker.get_default().get_window_app(this.window);
            if (app) {
                this.icon.child = app.create_icon_texture(ICON_SIZE);
            } else {
                this.icon.child = new St.Icon({
                    icon_name: 'application-x-executable',
                    icon_size: ICON_SIZE,
                });
            }
        }
    }

    _updateMinimized() {
        console.log("WindowButton._updateMinimized() called");
        if (this.button) {
            let alpha = this.window.minimized ? MINIMIZED_ALPHA : 1.0;
            this.icon.opacity = alpha * 255;
            this.label.opacity = alpha * 255;
        }
    }

    _updateDemandsAttention() {
        console.log("WindowButton._updateDemandsAttention() called");
    }

    _updateFocus() {
        if (this.button) {
            let isFocused = this._isFocused();
            if (isFocused) {
                console.log("WindowButton._updateFocus() called");
                this.button.style = `border-width: 1px; border-radius: 0px; transition-duration: 0s; background-color: ${FOCUSED_BACKGROUND_COLOR};`;
            } else {
                this.button.style = 'border-width: 1px; border-radius: 0px; transition-duration: 0s;';
            }
        }
    }

    _isFocused() {
        let focusedWindow = global.display.focus_window;
        // Check transient windows (dialogs, etc.)
        while (focusedWindow) {
            if (focusedWindow === this.window) {
                return true;
            }
            focusedWindow = focusedWindow.get_transient_for();
        }
        return false;
    }

    _onButtonDestroyed() {
        console.log("WindowButton._onButtonDestroyed() called");
        this.button = null;
        this.hbox = null;
        this.icon = null;
        this.label = null;
    }

    destroy() {
        if (this.button) {
            this.button.destroy();
        }
    }
}

class WindowList {
    constructor(panel) {
        this.panel = panel;
        this.windowButtons = [];
        
        // Create horizontal container for window buttons
        this.container = new St.BoxLayout({
            style_class: 'window-list-container',
            x_expand: false,
        });
        
        this.container.connect('destroy', this._onContainerDestroyed.bind(this));

        // Insert container into panel's left box
        panel._leftBox.insert_child_at_index(this.container, -1);
        
        // Watch for window creation:
        global.display.connectObject(
            'window-created',
            this._onWindowCreated.bind(this),
            'window-entered-monitor',
            this._onWindowEnteredMonitor.bind(this),
            'window-left-monitor',
            this._onWindowLeftMonitor.bind(this),
            this,
        );
        
        global.window_manager.connectObject(
            'switch-workspace',
            this._onSwitchWorkspace.bind(this),
            this,
        )

        // Initialize with existing windows
        global.get_window_actors().forEach(window => {
            this._onWindowCreated(global.display, window.meta_window);
        });
        
        console.log(`WindowList created for panel on monitor ${panel.monitor.index}`);
    }
    
    _getWindowButton(window) {
        const windowId = window.get_id();
        const buttonIndex = this.windowButtons.findIndex(btn => btn.windowId === windowId);
        if (buttonIndex !== -1) {
            return this.windowButtons[buttonIndex];
        }
        return null;
    }

    _onWindowCreated(display, window) {
        // Monitor signals of interest:
        window.connectObject(
            'unmanaged',
            this._onWindowUnmanaged.bind(this),
            'workspace-changed',
            this._onWindowWorkspaceChanged.bind(this),
            this,
        )

        // Create WindowButton and add to container
        const button = new WindowButton(window, this.panel.monitor.index);
        this.windowButtons.push(button);
        this.container.add_child(button.button);
    }
    
    _onWindowEnteredMonitor(display, monitor_index, window) {
        console.log("WindowList._onWindowEnteredMonitor() called");
        let button = this._getWindowButton(window);
        if (button) {
            // Move to the end of the list:
            if (ISOLATE_MONITORS) {
                this.container.remove_child(button.button);
                this.container.add_child(button.button);
            }
            button.updateVisibility();
        }
    }

    _onWindowLeftMonitor(display, monitor_index, window) {
        console.log("WindowList._onWindowLeftMonitor() called");
        let button = this._getWindowButton(window);
        if (button) {
            button.updateVisibility();
        }
    }
    
    _onWindowWorkspaceChanged(window) {
        console.log("WindowList._onWindowWorkspaceChanged() called");
        let button = this._getWindowButton(window);
        if (button) {
            // Move to the end of the list:
            if (ISOLATE_WORKSPACES) {
                this.container.remove_child(button.button);
                this.container.add_child(button.button);
            }
            button.updateVisibility();
        }
    }

    _onSwitchWorkspace() {
        this.windowButtons.forEach(button => {
            button.updateVisibility();
        });
    }

    _onWindowUnmanaged(window) {
        console.log("WindowList._onWindowUnmanaged() called");
        // Find and remove the corresponding WindowButton
        let button = this._getWindowButton(window);
        if (button) {
            this.container.remove_child(button.button);
            button.destroy();
            this.windowButtons.splice(buttonIndex, 1);
        }
    }
    
    _onContainerDestroyed() {
        console.log("WindowList._onContainerDestroyed() called");
        this.container = null;
    }

    destroy() {
        global.display.disconnectObject(this);
        
        // Clean up all window buttons
        this.windowButtons.forEach(windowButton => {
            windowButton.destroy();
        });
        this.windowButtons = [];
        
        // Remove container from panel and destroy it
        if (this.container) {
            this.panel._leftBox.remove_child(this.container);
            this.container.destroy();
        }
        console.log(`WindowList destroyed for panel on monitor ${this.panel.monitor.index}`);
    }
}

export default class PanelWindowListExtension extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    enable() {
        this.windowLists = [];
        
        // Watch for extensions being enabled and disabled:
        Main.extensionManager.connectObject(
            'extension-state-changed',
            this._onExtensionStateChanged.bind(this),
            this,
        );
        // // Watch for monitors being added, removed, or modified:
        // Main.layoutManager.connectObject(
        //     'monitors-changed',
        //     this._onMonitorsChanged.bind(this),
        //     this,
        // );
        
        // Check if dash to panel is active already:
        if (global.dashToPanel) {
            this._connectToDashToPanel();
        }

        console.log("PWL enabled");
    }

    _onExtensionStateChanged(manager, extension) {
        if (extension.uuid === DASH_TO_PANEL_UUID) {
            if (extension.state === ExtensionState.ACTIVE) {
                // Dash to panel enabled. Start watching for panel creation:
                console.log("Dash to panel was activated");
                this._connectToDashToPanel();
            }
            if (extension.state === ExtensionState.INACTIVE) {
                // Dash to panel disabled, clean up:
                console.log("Dash to panel was deactivated");
                this._destroyWindowLists();
            }
        }
    }

    _connectToDashToPanel() {
        global.dashToPanel.connectObject(
            'panels-created',
            this._onPanelsCreated.bind(this),
            this
        );
        this._onPanelsCreated()
    }

    _onPanelsCreated() {
        console.log("Panels created");
        // Clean up existing window lists:
        this._destroyWindowLists();
        // Create new window lists for each panel:
        global.dashToPanel.panels.forEach(panel => {
            console.log(`Got panel on monitor ${panel.monitor.index}`);
            const windowList = new WindowList(panel);
            this.windowLists.push(windowList);
        });
    }

    // _onMonitorsChanged() {
    //     console.log("Monitors changed");
    // }

    // _onWorkspaceAdded() {
    //     console.log("Workspace added");
    // }

    // _onWorkspaceRemoved() {
    //     console.log("Workspace removed");
    // }


    // _addToPanel(panel) {
    //     let button = new St.Label({
    //         text: 'Window List',
    //         style_class: 'panel-button',
    //         width: 140,
    //         x_expand: false,
    //     });
    //     panel._leftBox.insert_child_at_index(button, -1);
    //     this._buttons.push(button)
    // }

    // _removeFromPanel(panel) {
    //     this._buttons = this._buttons.filter(item => {
    //         if (item.panel === panel) {
    //             item.label.destroy();
    //             return false;
    //         }
    //         return true;
    //     });
    // }

    _destroyWindowLists() {
        // Clean up all WindowList instances
        console.log("Destroying windowLists");
        this.windowLists.forEach(windowList => {
            windowList.destroy();
        });
        this.windowLists = [];
    }

    disable() {
        this._destroyWindowLists();
        global.dashToPanel?.disconnectObject(this);
        // Main.layoutManager.disconnectObject(this);
        Main.extensionManager.disconnectObject(this);
        
        console.log("PWL extension disabled");
    }
}
