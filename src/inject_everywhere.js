if (window.SM_INJECT === undefined) {
    const DEBUG = chrome.runtime.getManifest().version === '10000';
    window.SM_INJECT = { count: 0 };

    class GoogleMapFinder {
        static _matchAncestor(node, predicate) {
            if (predicate(node)) {
                return node;
            }
            if (node.parentNode && node.parentNode !== node) {
                return this._matchAncestor(node.parentNode, predicate);
            }
            return null;
        }

        static _findGmStyleMap() {
            return Array.from(document.querySelectorAll('.gm-style'))
                .filter(
                    (container) =>
                        this._querySrc(container, 'img', [
                            '//maps.googleapis.com/maps/',
                            '//www.google.com/maps/',
                            '//maps.google.com/maps/',
                        ]) || container.querySelector('canvas'),
                )
                .map((container) => container.parentNode);
        }

        static _isGoogleEarthPage() {
            const earthUrls = [
                '//earth.google.com/web/', // Replace with actual Google Earth URL substrings
                '//www.google.com/earth/',
                '//earth.google.com/',
            ];
            return earthUrls.some(
                (url) => window.location.href.indexOf(url) !== -1,
            );
        }

        static _querySrc(container, tag, possible_substrings) {
            for (let elem of container.querySelectorAll(tag)) {
                for (let substring of possible_substrings) {
                    if (elem.src.indexOf(substring) !== -1) {
                        return true;
                    }
                }
            }
            return false;
        }

        static _findFallbackMap() {
            let foundImages = Array.from(
                document.querySelectorAll(
                    'img[src*="//maps.googleapis.com/maps/"]',
                ),
            );
            // To handle multiple maps on the same page, we make the threshold
            // number of images / 4. We consider the common ancestor to be found below
            // that threshold.
            let foundThreshold = foundImages.length / 4;
            for (let i = 0; i < 5; i++) {
                // Walk maximum 5 levels to find the common ancestor
                foundImages = foundImages.map((img) => img.parentNode);
                const foundSet = new Set(foundImages);
                if (foundSet.size <= foundThreshold) {
                    return Array.from(foundSet).map((container) =>
                        this._matchAncestor(
                            container,
                            (node) =>
                                isVisible(node) &&
                                node.offsetHeight > 1 &&
                                node.offsetWidth > 1,
                        ),
                    );
                }
            }
            return [];

            function isVisible(node) {
                window.getComputedStyle(node).display !== 'none';
            }
        }

        static findMaps() {
            if (this._isGoogleEarthPage()) {
                const googleEarthContainers =
                    document.querySelectorAll('#flt-pv-1');
                window.MAP_TYPE = 'earth';
                return googleEarthContainers;
            }

            let mapContainers = GoogleMapFinder._findGmStyleMap();
            if (mapContainers.length > 0) {
                return mapContainers;
            }

            mapContainers = GoogleMapFinder._findFallbackMap();
            window.MAP_TYPE = 'gm';
            return mapContainers;
        }
    }

    async function scrollifyExistingMaps() {
        const maps = GoogleMapFinder.findMaps();
        if (DEBUG) console.log('Found Google maps in page?', maps);
        if (maps.length <= 0) {
            return false;
        }
        for (const map of maps) {
            if (!map.hasAttribute('data-scrollmaps')) {
                new ScrollableMap(map, ScrollableMap.TYPE_API, SM_INJECT.count++, await Pref.getAllOptions());
            } else {
                if (DEBUG) console.log('Skipping already scrollified map');
            }
        }
        return true;
    }

    function sleep(timeout) {
        return new Promise((accept, _) => { setTimeout(accept, timeout); });
    }

    async function poll(func, timeout, count) {
        for (let i = 0; i < count; i++) {
            console.log('poll scrollify maps', i);
            func();
            await sleep(timeout * Math.pow(2, i));
        }
    }

    // Init
    let lastEventTime = 0;
    const THROTTLE_TIME_MS = 2000;
    window.addEventListener('wheel', async (e) => {
        if (e.timeStamp - lastEventTime > THROTTLE_TIME_MS) {
            await scrollifyExistingMaps();
            lastEventTime = e.timeStamp;
        }
    }, true);
    poll(scrollifyExistingMaps, 2000, 3);

    window.addEventListener('mapsFound', async function (event) {
        let map = event.target;
        new ScrollableMap(map, event.detail.type, SM_INJECT.count++, await Pref.getAllOptions());
    }, true);
}
