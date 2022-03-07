const open = require('open');

module.exports = function(grunt) {

grunt.loadNpmTasks('grunt-contrib-compress');
grunt.loadNpmTasks('grunt-contrib-concat');
grunt.loadNpmTasks('grunt-contrib-copy');
grunt.loadNpmTasks('grunt-contrib-uglify');
grunt.loadNpmTasks('grunt-contrib-watch');
grunt.loadNpmTasks('grunt-mocha-test');
grunt.loadNpmTasks('grunt-newer');
grunt.loadNpmTasks('grunt-exec');
grunt.loadNpmTasks('grunt-env');

grunt.initConfig({
    uglify: {
        all: {
            files: [
                {
                    dest: '<%= pluginDir %>/inject_content.min.js',
                    src: ['src/inject_content.js']
                },
                {
                    dest: '<%= pluginDir %>/mapapi_inject.min.js',
                    src: [
                        "src/prefreader.js",
                        "src/Scrollability.js",
                        "src/ScrollableMap.js",
                        "src/mapapi_inject.js"
                    ]
                },
                {
                    dest: '<%= pluginDir %>/scrollability_inject.min.js',
                    src: [
                        "src/Scrollability.js"
                    ]
                },
                {
                    dest: '<%= pluginDir %>/inject_frame.min.js',
                    src: [
                        "src/prefreader.js",
                        "src/Scrollability.js",
                        "src/ScrollableMap.js",
                        "src/inject_frame.js"
                    ]
                }
            ]
        }
    },
    concat: {
        options: {
            process: function(src, filepath) {
                // Double inclusion guard, since webrequest can inject the script
                // many times
                let name = filepath.split('/');
                name = name[name.length - 1];
                return `if (!window["..SMLoaded:${name}"]) {` + src +
                    `window["..SMLoaded:${name}"]=true;}`;
            }
        },
        all: {
            files: [
                {
                    dest: '<%= pluginDir %>/inject_content.min.js',
                    src: ['<%= pluginDir %>/inject_content.min.js']
                },
                {
                    dest: '<%= pluginDir %>/mapapi_inject.min.js',
                    src: ['<%= pluginDir %>/mapapi_inject.min.js']
                },
                {
                    dest: '<%= pluginDir %>/scrollability_inject.min.js',
                    src: ['<%= pluginDir %>/scrollability_inject.min.js']
                },
                {
                    dest: '<%= pluginDir %>/inject_frame.min.js',
                    src: ['<%= pluginDir %>/inject_frame.min.js']
                }
            ]
        }
    },
    copy: {
        all: {
            files: [{
                expand: true,
                src: [
                    'src/**/*.js',
                    'src/**/*.css',
                    'src/**/*.html',
                ],
                dest: '<%= pluginDir %>'
            }]
        },
        node_modules: {
            files: [{
                src: [
                    // 'node_modules/jquery/dist/jquery.min.js',
                ],
                // dest: '<%= pluginDir %>/src/jquery.js'
            }]
        },
        manifest: {
            files: [{
                src: ['manifest_template.json'],
                dest: '<%= pluginDir %>/manifest.json'
            }],
            options: {
                process: processManifestTemplate
            }
        },
        images: {
            files: [{
                expand: true,
                src: ['images/**/*.png'],
                dest: '<%= pluginDir %>'
            }]
        },
    },
    compress: {
        release: {
            options: {
                archive: 'gen/scrollmaps-<%= version %>-<%= browser %>.zip'
            },
            files: [{
                expand: true,
                cwd: '<%= pluginDir %>',
                src: ['**'],
                dest: '/'
            }]
        },
        firefoxtest: {
            options: {
                archive: 'gen/scrollmaps-<%= version %>-firefox.zip'
            },
            files: [{
                expand: true,
                cwd: '<%= pluginDir %>',
                src: ['**'],
                dest: '/'
            }]
        }
    },
    exec: {
        git_push: 'git push',
        npm_version: 'npm version <%= version %>"'
    },
    open: {
        gen_dir: 'gen',
        github_release: 'https://github.com/mauricelam/ScrollMaps/releases/new?tag=v<%= version %>',
        webstore: 'https://chrome.google.com/webstore/developer/edit/jifommjndpnefcfplgnbhabocomgdjjg',
        mozillastore: 'https://addons.mozilla.org/en-US/developers/addon/scrollmaps/ownership',
        edgestore: 'https://partner.microsoft.com/en-us/dashboard/microsoftedge/27ae3b1c-3f31-477b-b8e3-bddb29477f74/packages'
    },
    mochaTest: {
        all: {
            options: {
                reporter: 'spec',
                noFail: false, // Optionally set to not fail on failed tests (will still fail on other errors)
                timeout: 100000
            },
        },
        manual: {
            src: ['test/manual/*.js']
        },
        semimanual: {
            src: ['test/semimanual/*.js']
        },
        auto: {
            src: ['test/auto/*.js']
        }
    },
    watch: {
        chrome: {
            files: [
                'Gruntfile.js',
                'src/**/*.js',
                'src/**/*.html',
                'src/**/*.css',
                'manifest_template.json'
            ],
            tasks: ['dev:chrome'],
            options: {
                atBegin: true
            }
        },
        firefox: {
            files: [
                'Gruntfile.js',
                'src/**/*.js',
                'src/**/*.html',
                'src/**/*.css',
                'manifest_template.json'
            ],
            tasks: ['dev:firefox'],
            options: {
                atBegin: true
            }
        },
        edge: {
            files: [
                'Gruntfile.js',
                'src/**/*.js',
                'src/**/*.html',
                'src/**/*.css',
                'manifest_template.json'
            ],
            tasks: ['dev:edge'],
            options: {
                atBegin: true
            }
        },
    },
    env: {
        chrome: { BROWSER: 'chrome' },
        firefox: { BROWSER: 'firefox' },
        edge: { BROWSER: 'edge' },
    }
});

grunt.registerMultiTask('open', function() {
    open(this.data);
});

grunt.registerTask('build', [
    'uglify:all',
    'concat:all',
    'generate_domains',
    'copy:all',
    'copy:node_modules',
    'copy:manifest',
    'copy:images']);

grunt.registerTask('dev', (browser) => {
    if (!browser) {
        grunt.fatal('Usage: grunt dev:{chrome/firefox/edge}');
    }
    grunt.task.run([
        `set_version:${browser}:10000`,
        'build',
    ]);
});

grunt.registerTask('release', [
    'releasebrowser:chrome',
    'releasebrowser:firefox',
    'releasebrowser:edge'
]);

grunt.registerTask('releasebrowser', (browser) => {
    let pkg = grunt.file.readJSON('package.json');
    grunt.task.run([
        `set_version:${browser}:${pkg.version || ''}`,
        'build',
        'compress:release'
    ]);
});

// TODO: move to npm directly?
grunt.registerTask('postversion', [
    'release',
    'open:gen_dir',
    'exec:git_push',
    'open:github_release',
    'open:webstore',
    'open:mozillastore',
    'open:edgestore']);

grunt.registerTask('version', ['exec:npm_version']);

grunt.registerTask('set_version', (browser, version) => {
    if (!version) grunt.fatal(`Invalid version "${version}"`);
    grunt.config.set('pluginDir', `gen/plugin-${version}-${browser}`);
    grunt.config.set('browser', browser);
    grunt.config.set('version', version);
});

grunt.registerTask('generate_domains', () => {
    let urls = getGoogleMapUrls();
    let pluginDir = grunt.config.get('pluginDir');
    grunt.file.write(
        `${pluginDir}/src/domains.js`,
        'const SCROLLMAPS_DOMAINS = ' + JSON.stringify(urls));
});

// ========== Generate manifest ========== //

function processManifestTemplate(content) {
    let manifest = JSON.parse(content);
    function processObj(obj) {
        if (Array.isArray(obj)) {
            let index = obj.indexOf('<%= all_google_maps_urls %>');
            if (index !== -1) {
                obj.splice(index, 1, ...getGoogleMapUrls());
            }
        }
        if (typeof obj === 'object') {
            for (let o in obj) {
                if (typeof obj[o] === 'object') {
                    processObj(obj[o]);
                }
            }
            if (grunt.config.get('browser') === 'chrome') {
                const chromeSettings = obj?.browser_specific_settings?.chrome;
                if (chromeSettings) {
                    for (const i in chromeSettings) {
                        obj[i] = chromeSettings[i];
                    }
                    delete obj.browser_specific_settings;
                }
            }
        }
    }
    processObj(manifest);
    manifest.version = '' + grunt.config.get('version');
    return JSON.stringify(manifest, null, '  ');
}

function getGoogleMapUrls() {
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


    let output = [];
    for (const tld of GOOGLE_MAPS_CCTLDS) {
        for (const format of GOOGLE_MAPS_URL_FORMATS) {
            output.push(format.replace('{tld}', tld));
        }
    }
    output = output.concat(GOOGLE_MAPS_SPECIAL_URLS);
    return output;
}

// ========== Unit tests ========== //

grunt.registerTask('test', (browser, test) => {
    if (!browser || !test) {
        console.error('Usage: grunt test:<chrome|edge|firefox>:<auto|semimanual|manual>');
        return;
    }
    const tasks = [
        `dev:${browser}`,
    ];
    if (browser === 'firefox') {
        tasks.push('compress:firefoxtest');
    }
    tasks.push(
        `env:${browser}`,
        `mochaTest:${test}`
    );
    grunt.task.run(tasks);
});

grunt.registerTask('testall', [
    'test:chrome:auto',
    'test:firefox:auto',
    'test:edge:auto',
]);

};
