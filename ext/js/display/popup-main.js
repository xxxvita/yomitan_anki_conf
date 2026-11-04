/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2020-2022  Yomichan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import {Application} from '../application.js';
import {DocumentFocusController} from '../dom/document-focus-controller.js';
import {querySelectorNotNull} from '../dom/query-selector.js';
import {HotkeyHandler} from '../input/hotkey-handler.js';
import {DisplayAnki} from './display-anki.js';
import {DisplayAudio} from './display-audio.js';
import {DisplayProfileSelection} from './display-profile-selection.js';
import {DisplayResizer} from './display-resizer.js';
import {DisplayCrumbs} from './display-crumbs.js';
import {DisplayDrag} from './display-drag.js';
import {DisplayMoreEntries} from './display-more-entries.js';
import {DisplayWordHover} from './display-word-hover.js';
import {DisplayStrip} from './display-strip.js';
import {DisplayTranslation} from './display-translation.js';
import {CONTENT_CLICK_EXCLUDE, CONTENT_CLICK_INCLUDE, Display} from './display.js';

await Application.main(true, async (application) => {
    const documentFocusController = new DocumentFocusController();
    documentFocusController.prepare();

    const hotkeyHandler = new HotkeyHandler();
    hotkeyHandler.prepare(application.crossFrame);

    const display = new Display(application, 'popup', documentFocusController, hotkeyHandler);
    await display.prepare();

    const displayAudio = new DisplayAudio(display);
    displayAudio.prepare();

    const displayAnki = new DisplayAnki(display, displayAudio);
    displayAnki.prepare();

    const displayStrip = new DisplayStrip(display);
    displayStrip.prepare();

    const displayCrumbs = new DisplayCrumbs(display);
    displayCrumbs.prepare();

    const displayDrag = new DisplayDrag(display);
    displayDrag.prepare();

    const displayMoreEntries = new DisplayMoreEntries(display, querySelectorNotNull(document, '#dictionary-entries'));
    displayMoreEntries.prepare();

    // Word under the mouse is lit where a click looks it up (design .hw:hover).
    const displayWordHover = new DisplayWordHover({
        include: CONTENT_CLICK_INCLUDE,
        exclude: CONTENT_CLICK_EXCLUDE,
        isEnabled: () => {
            const scanning = display.getOptions()?.scanning;
            return typeof scanning === 'object' && scanning !== null && scanning.enablePopupSearch;
        },
        scanAt: (x, y) => display.getScanStartAt(x, y),
    });
    displayWordHover.prepare();
    display.on('contentClear', () => { displayWordHover.clear(); });

    const displayTranslation = new DisplayTranslation(display);
    displayTranslation.prepare();

    const displayProfileSelection = new DisplayProfileSelection(display);
    void displayProfileSelection.prepare();

    const displayResizer = new DisplayResizer(display);
    displayResizer.prepare();

    display.initializeState();

    document.documentElement.dataset.loaded = 'true';
});
