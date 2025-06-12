import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js'
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js'
import St from 'gi://St';

// Feature checklist:
// Click raises or minimises
// Right click should get window menu
// Middle click close
// Scroll raises next window, no periodic boundary
// Click and drag reorders
// Window demanding attention gets highlighted
// Lighten on hover over and slightly more on click
// Dim significantly if minimised
// lightened if active window
// Tooltip is window title
// Minimise/restore animation should respect the location of the window list entry
// Window order should survive suspend/restore and monitor hotplugging

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

class WindowButton {
    constructor(window, monitor_index) {
        this.window = window;
        this.windowId = window.get_id();
        this.monitor_index = monitor_index;
        
        // Create label with first 10 chars of window title
        const title = window.get_title() || '';
        const truncatedTitle = title.length > 10 ? title.substring(0, 10) : title;
        
        this.button = new St.Label({
            text: truncatedTitle,
            style_class: 'panel-button',
            x_expand: false,
        });
        
        this.button.connect('destroy', this._onButtonDestroyed.bind(this));

        console.log(`WindowButton created for: ${truncatedTitle}`);
        this.updateVisibility();
    }
    
    updateVisibility() {
        let workspace = global.workspace_manager.get_active_workspace();
        let visible = !this.window.skip_taskbar &&
               (!ISOLATE_WORKSPACES || this.window.located_on_workspace(workspace)) &&
               (!ISOLATE_MONITORS || this.window.get_monitor() === this.monitor_index);
        this.button.visible = visible;
    }

    _onButtonDestroyed() {
        console.log("WindowButton._onButtonDestroyed() called");
        this.button = null;
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
            this
        );
        
        // Initialize with existing windows
        global.get_window_actors().forEach(window => {
            this._onWindowCreated(global.display, window.meta_window);
        });
        
        console.log(`WindowList created for panel on monitor ${panel.monitor.index}`);
    }
    
    _onWindowCreated(display, window) {
        let title = window.get_title();
        let wm_class = window.get_wm_class(); 
        let type = window.window_type;
        let workspace = window.get_workspace();
        let workspace_index = workspace.index();
        let monitor = window.get_monitor();
        let sticky = window.is_on_all_workspaces();
        let skip_taskbar = window.skip_taskbar;
        let minimized = window.minimized;
        let hidden = window.is_hidden();

        console.log("WindowList._onWindowCreated() called:");
        console.log(`            title: ${title}`);
        console.log(`         wm_class: ${wm_class}`);
        console.log(`             type: ${type}`);
        console.log(`  workspace_index: ${workspace_index}`);
        console.log(`          monitor: ${monitor}`);
        console.log(`           sticky: ${sticky}`);
        console.log(`     skip_taskbar: ${skip_taskbar}`);
        console.log(`        minimized: ${minimized}`);
        console.log(`           hidden: ${hidden}`);

        // Monitor signals of interest:
        window.connectObject('unmanaged', this._onWindowUnmanaged.bind(this), this);

        // Create WindowButton and add to container
        const windowButton = new WindowButton(window, this.panel.monitor.index);
        this.windowButtons.push(windowButton);
        this.container.add_child(windowButton.button);
    }
    
    _onWindowEnteredMonitor(display, window) {
        console.log("WindowList._onWindowEnteredMonitor() called");
    }
    
    _onWindowUnmanaged(window) {
        console.log("WindowList._onWindowUnmanaged() called");
        // Find and remove the corresponding WindowButton
        const windowId = window.get_id();
        const buttonIndex = this.windowButtons.findIndex(btn => btn.windowId === windowId);
        if (buttonIndex !== -1) {
            const windowButton = this.windowButtons[buttonIndex];
            this.container.remove_child(windowButton.button);
            windowButton.destroy();
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
