import { src, dest, series, parallel, watch } from 'gulp';
import uglify from 'gulp-uglify-es';
import concat from 'gulp-concat';
import del from 'del';
import rename from 'gulp-rename';
import zip from 'gulp-zip';
import mocha from 'gulp-mocha';
import { promises as fs } from 'fs';
import open from 'open';
import { makePromise, runParallel, runSeries, contentTransform } from './gulputils.esm.js';
import { exec } from 'child_process';
import util from 'util';

const BROWSERS = ['chrome', 'firefox', 'edge'];

function doubleInclusionGuard() {
    return contentTransform((contents, file, enc) =>
        `if (!window["..SMLoaded:${file.basename}"]) {` +
            `${contents}window["..SMLoaded:${file.basename}"]=true;` +
        `}`);
}

class BuildContext {

    constructor(browser, version) {
        if (!browser) throw new Error('Browser is not defined');
        if (!version) throw new Error('Version is not defined');
        this.browser = browser;
        this.version = version;

        // Bind all the functions of this instance
        for (const prop of Object.getOwnPropertyNames(BuildContext.prototype)) {
            if (this[prop] instanceof Function) {
                this[prop] = this[prop].bind(this);
                this[prop].displayName = `[${browser}] ${this[prop].name}`;
            }
        }
    }

    pluginDirPath() { return `gen/plugin-${this.version}-${this.browser}`; }

    pluginDir(subdir = '') {
        return dest(`${this.pluginDirPath()}/${subdir}`);
    }

    // ===== Tasks =====

    copySourceFiles() {
        return src([
            'src/**/*.js',
            'src/**/*.css',
            'src/**/*.html',
        ])
        .pipe(this.pluginDir('src'));
    }

    copyImages() {
        return src(['images/**/*.png'])
            .pipe(this.pluginDir('images'))
    }

    processManifest() {
        return src('manifest_template.json')
            .pipe(contentTransform(this._processManifestTemplate))
            .pipe(rename('manifest.json'))
            .pipe(this.pluginDir());
    }

    async generateDomainDotJs() {
        const urls = this._getGoogleMapUrls();
        await fs.mkdir(`${this.pluginDirPath()}/src`, { recursive: true });
        await fs.writeFile(
            `${this.pluginDirPath()}/src/domains.js`,
            'const SCROLLMAPS_DOMAINS = ' + JSON.stringify(urls));
    }

    _processManifestTemplate(content) {
        let manifest = JSON.parse(content);
        let processObj = (obj) => {
            if (Array.isArray(obj)) {
                let index = obj.indexOf('<%= all_google_maps_urls %>');
                if (index !== -1) {
                    obj.splice(index, 1, ...this._getGoogleMapUrls());
                }
            }
            if (typeof obj === 'object') {
                for (let o in obj) {
                    if (typeof obj[o] === 'object') {
                        processObj(obj[o]);
                    }
                }
                if (this.browser === 'chrome') {
                    if (obj && obj.browser_specific_settings && obj.browser_specific_settings.chrome) {
                        const chromeSettings = obj.browser_specific_settings.chrome;
                        if (chromeSettings) {
                            for (const i in chromeSettings) {
                                obj[i] = chromeSettings[i];
                            }
                            delete obj.browser_specific_settings;
                        }
                    }
                }
            }
        }
        processObj(manifest);
        manifest.version = '' + this.version;
        return JSON.stringify(manifest, null, '  ');
    }

    _getGoogleMapUrls() {
        const GOOGLE_MAPS_CCTLDS = [
            "at", "au", "be", "br", "ca", "cf", "cg", "ch", "ci", "cl", "cn", "uk", "in", "jp", "th",
            "cz", "dj", "de", "dk", "ee", "es", "fi", "fr", "ga", "gm", "hk", "hr", "hu", "ie", "is",
            "it", "li", "lt", "lu", "lv", "mg", "mk", "mu", "mw", "nl", "no", "nz", "pl", "pt", "ro",
            "ru", "rw", "sc", "se", "sg", "si", "sk", "sn", "st", "td", "tg", "tr", "tw", "ua", "us"];

        const GOOGLE_MAPS_URL_FORMATS = [
            "*://www.google.{tld}/maps*",
            "*://www.google.com.{tld}/maps*",
            "*://www.google.co.{tld}/maps*",
            "*://maps.google.{tld}/*",
            "*://maps.google.com.{tld}/*",
            "*://maps.google.co.{tld}/*"
        ];

        const GOOGLE_MAPS_SPECIAL_URLS = [
            "*://www.google.com/maps*",
            "*://maps.google.com/*",
            "*://mapy.google.pl/*",
            "*://ditu.google.cn/*"
        ];


        const output = [...GOOGLE_MAPS_SPECIAL_URLS];
        for (const tld of GOOGLE_MAPS_CCTLDS) {
            for (const format of GOOGLE_MAPS_URL_FORMATS) {
                output.push(format.replace('{tld}', tld));
            }
        }
        return output;
    }

    MINIFY_FILES = {
        'mapapi_inject': [
            "src/prefreader.js",
            "src/Scrollability.js",
            "src/ScrollableMap.js",
            "src/mapapi_inject.js"
        ],
        'inject_content': ['src/inject_content.js'],
        'scrollability_inject': ["src/Scrollability.js"],
        'inject_frame': [
            "src/prefreader.js",
            "src/Scrollability.js",
            "src/ScrollableMap.js",
            "src/inject_frame.js"
        ]
    }

    zipExtension() {
        return src([this.pluginDirPath() + '/**'])
            .pipe(zip(`scrollmaps-${this.version}-${this.browser}.zip`))
            .pipe(dest('gen'));
    }

    async build() {
        const minifyTasks = Object.entries(this.MINIFY_FILES).map(([output, sourceFiles]) => {
            const minifyTask = () =>
                src(sourceFiles)
                    .pipe(concat(`${output}.min.js`))
                    .pipe(uglify())
                    .pipe(doubleInclusionGuard())
                    .pipe(this.pluginDir());
            minifyTask.displayName = `[${this.browser}] minify_${output}`
            return minifyTask;
        });
        const buildUnpacked = parallel(
            ...minifyTasks,
            this.copySourceFiles,
            this.generateDomainDotJs,
            this.copyImages,
            this.processManifest,
        );
        if (this.browser === 'firefox') {
            return runSeries(buildUnpacked, this.zipExtension);
        } else {
            return makePromise(buildUnpacked);
        }
    }

    // ===== Test tasks =====

    async _generateTestJson() {
        // Install a mocha hook that writes to process.env.BROWSER.
        // This is to work around the fact that gulp-mocha does not
        // have a way to set process env variables per process, and
        // setting it globally in the current process breaks parallel
        // test runs.
        await fs.mkdir('gen/intermediates', { recursive: true });
        await fs.writeFile(
            `gen/intermediates/mocha-require-${this.browser}.mjs`,
            `export const mochaHooks = () => { process.env.BROWSER = "${this.browser}" }`)
    }

    async runAutoTest() {
        await this._generateTestJson();
        await makePromise(
            () => src('test/auto/*.js')
                .pipe(mocha({
                    require: [`gen/intermediates/mocha-require-${this.browser}.mjs`],
                    reporter: 'spec',
                    timeout: 100000
                }))
        );
    }

    async runManualTest() {
        await this._generateTestJson();
        await makePromise(
            () => src('test/manual/*.js')
                .pipe(mocha({
                    require: [`gen/mocha-require-${this.browser}.mjs`],
                    reporter: 'spec',
                    timeout: 100000
                }))
        );
    }

    // ===== Release tasks =====

    async openStoreLink() {
        switch (this.browser) {
            case 'chrome':
                await open('https://chrome.google.com/webstore/developer/edit/jifommjndpnefcfplgnbhabocomgdjjg');
            case 'edge':
                await open('https://partner.microsoft.com/en-us/dashboard/microsoftedge/27ae3b1c-3f31-477b-b8e3-bddb29477f74/packages');
            case 'firefox':
                await open('https://addons.mozilla.org/en-US/developers/addon/scrollmaps/ownership');
            default:
                throw new Error(`Unsupported browser ${this.browser}`)
        }
    }
}

async function testall() {
    const tasks = BROWSERS.map((browser) => {
        const bc = new BuildContext(browser, 10000);
        return series(bc.build, bc.runAutoTest);
    });
    return runParallel(...tasks);
}

async function test() {
    const bc = new BuildContext(process.env.BROWSER, 10000);
    return runSeries(bc.build, bc.runAutoTest);
}

async function devBuild() {
    return new BuildContext(process.env.BROWSER, 10000).build();
}

async function releaseBuild() {
    const packageJsonString = await fs.readFile('package.json');
    const packageJson = JSON.parse(packageJsonString);
    if (!packageJson.version) {
        throw new Error('Cannot get version from package.json')
    }
    const tasks = BROWSERS
        .map((browser) => new BuildContext(browser, packageJson.version))
        .map((bc) => series(bc.build, bc.zipExtension));
    return runParallel(...tasks);
}


// Task to be run after running `npm version [major/minor]`
async function postVersion() {
    const packageJsonString = await fs.readFile('package.json');
    const packageJson = JSON.parse(packageJsonString);
    if (!packageJson.version) {
        throw new Error('Cannot get version from package.json')
    }
    const tasks = BROWSERS
        .map((browser) => new BuildContext(browser, packageJson.version))
        .map((bc) => series(bc.build, bc.zipExtension));
    await runSeries(
        parallel(...tasks),
        parallel(
            async () => util.promisify(exec)('git push'),
            async () => open('gen'),
        ),
        async () => open(`https://github.com/mauricelam/ScrollMaps/releases/new?tag=v${packageJson.version}`),
    );
}

function clean() {
    return del(['gen/*']);
}

export {
    devBuild as default,
    devBuild as dev,
    releaseBuild as release,
    clean,
    test,
    testall,
    postVersion,
}
