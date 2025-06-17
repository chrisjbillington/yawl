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
        this.button.child = app.create_icon_texture(ICON_SIZE);
        
        this.button.connect('clicked', () => {
            app.open_new_window(-1);
        });

        this._tooltip.set(this.button, this.app.get_name());

        container.add_child(this.button);
    }

    setDragging(isDragging) {
        // console.log("FavoritesButton.setDragging()");
        if (!this.button) return;
        if (isDragging) {
            this.button.add_style_class_name('dragging');
        } else {
            this.button.remove_style_class_name('dragging');
            // When dragging, we may not have received a release event. This ensures
            // styling is updated to reflect the button no longer being pressed:
            this.button.fake_release();
        }
    }

    _onButtonDestroyed() {
        // console.log("FavoritesButton._onButtonDestroyed()");
        this.button = null;
    }

    destroy() {
        // console.log("FavoritesButton.destroy()");
        if (this.button) {
            this.button.destroy();
        }
    }
}
