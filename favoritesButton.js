import St from 'gi://St';

const ICON_SIZE = 18;

export class FavoritesButton {
    constructor(app, container, tooltip) {
        // console.log("FavoritesButton.constructor()");
        this.app = app;
        this.container = container;
        this._tooltip = tooltip;
        
        this.button = new St.Button({
            style_class: 'favorites-button',
        });
        this.button.connect('destroy', this._onButtonDestroyed.bind(this));
        this.button.connect('button-press-event', this._onButtonPress.bind(this));
        this.button.connect('notify::hover', this._onHover.bind(this));
        this.button.child = app.create_icon_texture(ICON_SIZE);
        
        this.button.connect('clicked', () => {
            app.open_new_window(-1);
        });

        container.add_child(this.button);
    }

    setDragging(isDragging) {
        // console.log("FavoritesButton.setDragging()");
        if (!this.button) return;
        if (isDragging) {
            this.button.add_style_class_name('dragging');
            this._tooltip.inhibit();
        } else {
            this.button.remove_style_class_name('dragging');
            this.button.fake_release();
        }
        this.button.sync_hover();
    }

    _onHover() {
        if (this.button.hover) {
            this._tooltip.show(this.button, this.app.get_name());
        } else {
            this._tooltip.hide();
        }
    }

    _onButtonPress(actor, event) {
        this._tooltip.inhibit();
    }

    _onButtonDestroyed() {
        // console.log("FavoritesButton._onButtonDestroyed()");
        this._tooltip.hide();
        this.button = null;
    }

    destroy() {
        // console.log("FavoritesButton.destroy()");
        this._tooltip.hide();
        if (this.button) {
            this.button.destroy();
        }
    }
}
