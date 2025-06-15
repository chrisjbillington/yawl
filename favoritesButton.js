import St from 'gi://St';

const ICON_SIZE = 18;

export class FavoritesButton {
    constructor(app, container) {
        // console.log("FavoritesButton.constructor()");
        this.app = app;
        this.button = new St.Button({
            style_class: 'favorites-button',
        });
        this.button.connect('destroy', this._onButtonDestroyed.bind(this));
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
        } else {
            this.button.remove_style_class_name('dragging');
            this.button.fake_release();
        }
        this.button.sync_hover();
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
