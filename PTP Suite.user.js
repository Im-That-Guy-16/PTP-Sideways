// ==UserScript==
// @name         PTP Suite (All-in-One)
// @namespace    https://passthepopcorn.me/
// @version      1.1.11
// @description  Every PTP userscript in one install: TMDB Enricher, TMDB People, Latest Digital, IMDb Parents Guide via GraphQL, Radarr integration, fanart.tv Clearlogo panel, trailer modal, collapsible torrent categories, homepage Top 10 poster strip, and single-row Top 10 posters. Modules are individually gated to the pages their standalone versions matched, and each is isolated so one failure can't take down the rest.
// @author       you
// @updateURL    https://gitlab.com/Prism_16/PTP-Sideways/-/raw/main/PTP%20Suite.user.js?inline=false
// @downloadURL  https://gitlab.com/Prism_16/PTP-Sideways/-/raw/main/PTP%20Suite.user.js?inline=false
// @match        *://passthepopcorn.me/*
// @match        *://www.passthepopcorn.me/*
// @connect      api.themoviedb.org
// @connect      image.tmdb.org
// @connect      api.graphql.imdb.com
// @connect      webservice.fanart.tv
// @connect      passthepopcorn.me
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM.xmlHttpRequest
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.deleteValue
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
 * MERGED FROM (all logic preserved verbatim from the standalone scripts):
 *   1. PTP TMDB Enricher                  v1.2.0   torrents.php + homepage
 *   2. PTP -> IMDb Parents Guide (GraphQL) v2.3.0  torrents.php
 *   3. PTP Radarr Integration             v0.3.2   torrents.php + user.php?action=edit
 *   4. PTP fanart.tv Clearlogo Panel      v1.0.0   torrents.php
 *   5. PTP Trailer Modal                  v2.0     torrents.php
 *   6. PTP - Collapse Torrent Categories  v1.0     torrents.php?id=*
 *   7. PTP Daily Top 10 Posters           v1.4.0   homepage
 *   8. PTP Top 10 - Single Row Posters    v1.0     top10.php
 *   9. PTP Latest Digital                 v1.0.0   optional native page
 *  10. PTP TMDB People                    v1.0.0   artist.php
 *
 * KEYS
 *   * fanart.tv  - shared by the Clearlogo module and TMDB People/Latest Digital artwork.
 *   * TMDB       - NOT in this file. Set it once from the Tampermonkey menu
 *                  ("Set TMDB API key"); both the Enricher and the homepage
 *                  Top 10 strip read the same stored value.
 *
 * RUN ORDER on a movie page is deliberate: Enricher first (builds the hero and
 * hides the native title), then Parents Guide, Trailer Modal, Radarr, Clearlogo,
 * Collapse -- so the linkbox ends up as [PTP Cast][Comments] ... [YouTube] [Radarr].
 */

(function () {
    'use strict';

    /* ================================================================== *
     *  SHARED PRELUDE - page routing, settings menu, module runner       *
     * ================================================================== */
    const PATH = location.pathname;
    const PAGE = {
        torrents:  /^\/torrents\.php$/i.test(PATH),
        movie:     /^\/torrents\.php$/i.test(PATH) && /[?&]id=\d+/.test(location.search),
        home:      PATH === '/' || /^\/index\.php$/i.test(PATH),
        top10:     /^\/top10\.php$/i.test(PATH),
        user:      /^\/user\.php$/i.test(PATH),
        artist:    /^\/artist\.php$/i.test(PATH) && /[?&]id=\d+/.test(location.search),
    };

    // Safe at document-start, when <head> may not exist yet.
    function addStyleEarly(css) {
        const st = document.createElement('style');
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
        return st;
    }

    const FEATURE_FLAGS = [
        { key: 'iconUserBar', label: 'Icon user bar', desc: 'Compact icon treatment for the top account bar.', defaultEnabled: true },
        { key: 'tmdbEnricher', label: 'TMDB movie panels', desc: 'Hero, cast, facts, recommendations, watch providers and review panels.', defaultEnabled: true },
        { key: 'tmdbPeople', label: 'TMDB people pages', desc: 'Revamps artist pages with TMDB biographies, images and known-for credits.', defaultEnabled: true },
        { key: 'parentsGuide', label: 'IMDb Parents Guide', desc: 'Adds the IMDb content guide panel on movie pages.', defaultEnabled: true },
        { key: 'radarr', label: 'Radarr links', desc: 'Shows Radarr add/status links on movie pages.', defaultEnabled: true },
        { key: 'clearlogo', label: 'fanart.tv clearlogo', desc: 'Adds the clearlogo artwork panel where available.', defaultEnabled: true },
        { key: 'trailerModal', label: 'Trailer popup', desc: 'Fixes YouTube trailer embeds into a popup player.', defaultEnabled: true },
        { key: 'collapseCategories', label: 'Torrent category collapse', desc: 'Adds show/hide controls to torrent category rows.', defaultEnabled: true },
        { key: 'dailyTop10', label: 'Homepage Top 10 posters', desc: 'Adds poster strips to the PTP homepage.', defaultEnabled: true },
        { key: 'top10SingleRow', label: 'Top 10 single row', desc: 'Keeps the Top 10 page poster view in one horizontal row.', defaultEnabled: true },
        { key: 'latestDigital', label: 'Latest Digital page', desc: 'Enables the optional TMDB-powered latest digital release view.', defaultEnabled: false, storageKey: 'ptp_latest_digital_enabled' },
    ];

    function featureFlag(key) {
        return FEATURE_FLAGS.find(f => f.key === key);
    }

    function featureStorageKey(key) {
        const f = featureFlag(key);
        return (f && f.storageKey) || ('ptp_feature_' + key);
    }

    function featureEnabled(key) {
        const f = featureFlag(key);
        if (!f) return true;
        return !!GM_getValue(featureStorageKey(key), f.defaultEnabled !== false);
    }

    function setFeatureEnabled(key, value) {
        GM_setValue(featureStorageKey(key), !!value);
    }

    const DEFAULT_TMDB_REGION = 'GB';
    const FANART_TV_API_KEY = '8a3d24a20c50c65c9f729fa3e67eebd2';
    const TMDB_REGION_LABELS = {
        GB: 'UK',
        US: 'US',
        AU: 'Australia',
        CA: 'Canada',
        DE: 'Germany',
        ES: 'Spain',
        FR: 'France',
        IE: 'Ireland',
        IT: 'Italy',
        NL: 'Netherlands',
        NZ: 'New Zealand',
    };

    function normalizeRegion(value) {
        const v = String(value || '').trim().toUpperCase();
        return /^[A-Z]{2}$/.test(v) ? v : DEFAULT_TMDB_REGION;
    }

    function regionLabel(value) {
        const region = normalizeRegion(value);
        return TMDB_REGION_LABELS[region] || region;
    }

    function migrateUkRegionDefault() {
        const key = 'ptp_tmdb_region_uk_default_migrated';
        try {
            if (GM_getValue(key, false)) return;
            const region = String(GM_getValue('tmdb_region', '') || '').trim().toUpperCase();
            const lang = String(GM_getValue('tmdb_lang', '') || '').trim();
            if (!region || region === 'US') GM_setValue('tmdb_region', DEFAULT_TMDB_REGION);
            if (!lang || lang === 'en-US') GM_setValue('tmdb_lang', 'en-GB');
            GM_setValue(key, true);
        } catch (e) {}
    }

    migrateUkRegionDefault();

    // Shared TMDB settings. These are the same GM storage keys the standalone
    // TMDB Enricher used, so an existing key carries over untouched.
    const PTPSuite = {
        tmdbKey:    () => GM_getValue('tmdb_key', ''),
        tmdbRegion: () => normalizeRegion(GM_getValue('tmdb_region', DEFAULT_TMDB_REGION)),
        tmdbRegionLabel: () => regionLabel(PTPSuite.tmdbRegion()),
        tmdbLang:   () => GM_getValue('tmdb_lang', 'en-GB'),
        latestDigitalEnabled: () => featureEnabled('latestDigital'),
        featureEnabled,
        setFeatureEnabled,
        features: FEATURE_FLAGS,
    };

    function isLatestDigitalRoute() {
        return location.hash === '#ptp-latest-digital' || /[?&]ptp_latest_digital=1\b/i.test(location.search);
    }

    function registerMenu() {
        if (typeof GM_registerMenuCommand !== 'function') return;
        GM_registerMenuCommand('Set TMDB API key', () => {
            const v = prompt('Enter your TMDB API key (v3) or Read-Access-Token (v4 – starts with "eyJ"):', PTPSuite.tmdbKey() || '');
            if (v !== null) { GM_setValue('tmdb_key', v.trim()); location.reload(); }
        });
        GM_registerMenuCommand('Set region (watch providers / certs)', () => {
            const v = prompt('2-letter region code (e.g. GB for UK, US, AU, DE):', PTPSuite.tmdbRegion());
            if (v !== null) { GM_setValue('tmdb_region', normalizeRegion(v)); location.reload(); }
        });
        GM_registerMenuCommand('Set language', () => {
            const v = prompt('Language code (e.g. en-GB, en-US, de-DE):', PTPSuite.tmdbLang());
            if (v !== null) { GM_setValue('tmdb_lang', v.trim()); location.reload(); }
        });
        GM_registerMenuCommand((PTPSuite.latestDigitalEnabled() ? 'Disable' : 'Enable') + ' Latest Digital page', () => {
            PTPSuite.setFeatureEnabled('latestDigital', !PTPSuite.latestDigitalEnabled());
            location.reload();
        });
        GM_registerMenuCommand('Reset Latest Digital genres', () => {
            GM_deleteValue('ptp_latest_digital_genres');
            GM_deleteValue('ptp_latest_digital_cache');
            if (isLatestDigitalRoute()) location.reload();
        });
    }

    // One module blowing up must not stop the others.
    function runModule(name, fn) {
        try { fn(); }
        catch (e) { console.error('[PTP Suite] module "' + name + '" failed:', e); }
    }

    function onReady(fn) {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            setTimeout(fn, 0);
        } else {
            document.addEventListener('DOMContentLoaded', () => setTimeout(fn, 0), { once: true });
        }
    }

    function MOD_iconUserBar() {
        const ICONS = {
            edit: 'edit_square',
            logout: 'logout',
            upload: 'upload',
            invite: 'person_add',
            bonus: 'redeem',
            donate: 'volunteer_activism',
            inbox: 'inbox',
            'staff inbox': 'contact_mail',
            uploads: 'upload_file',
            bookmarks: 'bookmark',
            notifications: 'notifications',
            posts: 'article',
            subscriptions: 'notifications',
            comments: 'chat',
            more: 'more_horiz',
        };

        const iconFor = (label, link) => {
            const text = label.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
            const href = (link.getAttribute('href') || '').toLowerCase();
            const id = (link.parentElement && link.parentElement.id || '').toLowerCase();
            if (id === 'nav_more' || text === 'more') return ICONS.more;
            if (text.includes('subscription')) return ICONS.subscriptions;
            if (text.includes('comment')) return ICONS.comments;
            if (text in ICONS) return ICONS[text];
            if (href.includes('user.php')) return 'account_circle';
            return '';
        };

        const alertInfo = (label, link) => {
            const text = (label || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const base = text.replace(/\s*\([^)]*\)\s*$/, '').trim();
            const count = (text.match(/\(([\d,]+)\)/) || [])[1];
            const countNum = count ? parseInt(count.replace(/,/g, ''), 10) : 0;
            const hasCount = countNum > 0;
            const nativeHighlight = link.classList.contains('user-info-bar__link--highlighted');
            const alertable = /^(inbox|staff inbox|notifications?|subscriptions?|comments?|posts?)$/.test(base);
            return {
                active: alertable && (hasCount || nativeHighlight),
                count: hasCount ? (countNum > 99 ? '99+' : String(countNum)) : '',
            };
        };

        const linkLabel = (link) => Array.from(link.childNodes)
            .filter(node => !(node.nodeType === 1 && node.classList.contains('ptp-userbar-alert-badge')))
            .map(node => node.textContent || '')
            .join('')
            .replace(/\s+/g, ' ')
            .trim();

        const decorate = () => {
            document.querySelectorAll('.user-info-bar__list > .user-info-bar__item > a.user-info-bar__link').forEach((link) => {
                const label = linkLabel(link);
                const icon = label ? iconFor(label, link) : '';
                let badge = link.querySelector(':scope > .ptp-userbar-alert-badge');
                if (!icon) {
                    link.classList.remove('ptp-userbar-icon', 'ptp-userbar-has-alert');
                    if (badge) badge.remove();
                    delete link.dataset.ptpLabel;
                    delete link.dataset.ptpIcon;
                    return;
                }
                const alert = alertInfo(label, link);
                link.classList.add('ptp-userbar-icon');
                link.classList.toggle('ptp-userbar-has-alert', alert.active);
                link.dataset.ptpLabel = label;
                link.dataset.ptpIcon = icon;
                link.setAttribute('aria-label', label);
                if (alert.active) {
                    if (!badge) {
                        badge = document.createElement('span');
                        badge.className = 'ptp-userbar-alert-badge';
                        badge.setAttribute('aria-hidden', 'true');
                        link.appendChild(badge);
                    }
                    badge.classList.toggle('ptp-userbar-alert-badge-dot', !alert.count);
                    badge.setAttribute('aria-hidden', 'true');
                    if (badge.textContent !== alert.count) badge.textContent = alert.count;
                } else if (badge) {
                    badge.remove();
                }
            });
        };

        const decorateStats = () => {
            document.querySelectorAll('#userinfo_stats > .user-info-bar__item').forEach((item) => {
                const link = item.querySelector('a.user-info-bar__link');
                const value = item.querySelector('.user-info-bar__text');
                if (!link || !value) return;
                const label = (link.textContent || '').replace(/\s+/g, ' ').trim();
                const shortValue = (value.textContent || '').replace(/\s+/g, ' ').trim();
                const detail = (link.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
                item.dataset.ptpLabel = detail || (label && shortValue ? `${label}: ${shortValue}` : label || shortValue);
            });
        };

        decorate();
        decorateStats();
        const bar = document.querySelector('.user-info-bar');
        if (bar) new MutationObserver(() => { decorate(); decorateStats(); }).observe(bar, { childList: true, subtree: true, characterData: true });
    }

    /* ================================================================== *
     *  PTP Latest Digital v1.0.0  --  optional native page                *
     * ================================================================== */
    function MOD_latestDigital() {
    (function () {
        'use strict';

        const IMG = 'https://image.tmdb.org/t/p/';
        const API = 'https://api.themoviedb.org/3';
        const KEY_GENRES = 'ptp_latest_digital_genres';
        const KEY_CACHE = 'ptp_latest_digital_cache';
        const HASH = '#ptp-latest-digital';
        const CACHE_TTL = 6 * 3600e3;
        const DETAIL_TTL = 14 * 24 * 3600e3;
        const LOGO_TTL = 30 * 24 * 3600e3;
        const DAYS_BACK = 210;
        const PER_GENRE = 16;
        const ENGLISH_RELEASE_REGIONS = ['GB', 'US', 'CA', 'AU', 'IE', 'NZ'];
        const MAJOR_STUDIO_IDS = new Set([
            1, 2, 3, 4, 5, 7, 12, 14, 25, 33, 34, 43, 56, 60, 79, 103, 174,
            288, 306, 441, 508, 521, 559, 6194, 6704, 694, 8411, 923, 10146,
            1632, 3172, 491, 6277, 7493, 9993, 11461, 12292, 20580, 28433,
            41077, 90733, 119245, 127928, 154034, 165916, 178464, 194232
        ]);
        const MAJOR_STUDIO_WORDS = /\b(disney|pixar|marvel|lucasfilm|warner|new line|universal|illumination|dreamworks|paramount|columbia|sony|tristar|screen gems|20th century|searchlight|fox|mgm|amazon|apple|netflix|hbo|max|a24|neon|focus features|lionsgate|summit|legendary|skydance|blumhouse|miramax|studiocanal|bbc film|film4|mubi|ifc films|shudder|gkids|crunchyroll|toei|criterion|janus|magnolia|rlje|well go|kino lorber|arrow|saban)\b/i;

        let hiddenNodes = [];

        const getKey = () => PTPSuite.tmdbKey();
        const getRegion = () => PTPSuite.tmdbRegion();
        const getRegionLabel = () => PTPSuite.tmdbRegionLabel();
        const getLang = () => PTPSuite.tmdbLang();
        const pad2 = n => String(n).padStart(2, '0');
        const dateStr = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
        const yearOf = d => (d && /^\d{4}/.test(d)) ? d.slice(0, 4) : '';
        const shortDate = iso => {
            if (!iso) return '';
            try { return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
            catch (e) { return iso; }
        };
        const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

        function el(tag, attrs = {}, ...kids) {
            const node = document.createElement(tag);
            for (const [k, v] of Object.entries(attrs)) {
                if (k === 'class') node.className = v;
                else if (k === 'html') node.innerHTML = v;
                else if (k === 'text') node.textContent = v;
                else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
                else if (v !== null && v !== undefined) node.setAttribute(k, v);
            }
            kids.flat().forEach(kid => {
                if (kid === null || kid === undefined) return;
                node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
            });
            return node;
        }

        function gmJSON(key, fallback) {
            try {
                const raw = GM_getValue(key, null);
                if (raw === null || raw === undefined || raw === '') return fallback;
                return typeof raw === 'string' ? JSON.parse(raw) : raw;
            } catch (e) { return fallback; }
        }

        function setJSON(key, value) {
            GM_setValue(key, JSON.stringify(value));
        }

        function cacheGet(key, ttl) {
            const bag = gmJSON(KEY_CACHE, {});
            const item = bag[key];
            if (!item || !item.ts || Date.now() - item.ts > ttl) return null;
            return item.value;
        }

        function cacheSet(key, value) {
            const bag = gmJSON(KEY_CACHE, {});
            bag[key] = { ts: Date.now(), value };
            const keys = Object.keys(bag).sort((a, b) => bag[b].ts - bag[a].ts);
            keys.slice(80).forEach(k => delete bag[k]);
            setJSON(KEY_CACHE, bag);
        }

        function tmdb(path, params = {}) {
            const key = getKey();
            const usp = new URLSearchParams(params);
            usp.set('language', getLang());
            const isV4 = key.startsWith('eyJ');
            if (!isV4) usp.set('api_key', key);
            const headers = { 'Content-Type': 'application/json;charset=utf-8' };
            if (isV4) headers.Authorization = `Bearer ${key}`;
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: `${API}${path}?${usp.toString()}`,
                    headers,
                    timeout: 25000,
                    onload: r => {
                        try {
                            const json = JSON.parse(r.responseText || '{}');
                            if (r.status >= 200 && r.status < 300) resolve(json);
                            else reject(new Error(json.status_message || `TMDB HTTP ${r.status}`));
                        } catch (e) { reject(e); }
                    },
                    onerror: () => reject(new Error('TMDB network error')),
                    ontimeout: () => reject(new Error('TMDB request timed out')),
                });
            });
        }

        function ptpSearch(title, year) {
            const p = new URLSearchParams({ action: 'advanced', order_by: 'relevance', searchstr: title || '' });
            if (year) p.set('year', String(year));
            return '/torrents.php?' + p.toString();
        }

        function posterUrl(movie, size = 'w342') {
            return movie && movie.poster_path ? `${IMG}${size}${movie.poster_path}` : '';
        }

        function backdropUrl(movie, size = 'w1280') {
            return movie && movie.backdrop_path ? `${IMG}${size}${movie.backdrop_path}` : '';
        }

        function placeholder(title) {
            const text = esc(title || 'No Poster');
            return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
                `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 342 513"><rect width="342" height="513" fill="#141a23"/><text x="171" y="248" text-anchor="middle" fill="#6e7b8f" font-family="Arial" font-size="24" font-weight="700">${text}</text></svg>`
            );
        }

        function selectedGenres() {
            return gmJSON(KEY_GENRES, []);
        }

        function saveGenres(ids) {
            setJSON(KEY_GENRES, ids.map(Number).filter(Boolean));
        }

        function hasDigitalRelease(releaseDates, region) {
            const rows = (releaseDates && releaseDates.results) || [];
            const bucket = rows.find(r => r.iso_3166_1 === region);
            if (!bucket) return '';
            const today = dateStr(new Date());
            return (bucket.release_dates || [])
                .filter(d => d.type === 4 && d.release_date && d.release_date.slice(0, 10) <= today)
                .map(d => d.release_date.slice(0, 10))
                .sort()
                .pop() || '';
        }

        function combinedDigitalRelease(releaseDates) {
            const rows = (releaseDates && releaseDates.results) || [];
            const today = dateStr(new Date());
            const dates = [];
            ENGLISH_RELEASE_REGIONS.forEach(region => {
                const bucket = rows.find(r => r.iso_3166_1 === region);
                if (!bucket) return;
                (bucket.release_dates || []).forEach(d => {
                    const iso = d.release_date && d.release_date.slice(0, 10);
                    if (d.type === 4 && iso && iso <= today) dates.push({ region, iso });
                });
            });
            dates.sort((a, b) => b.iso.localeCompare(a.iso) || ENGLISH_RELEASE_REGIONS.indexOf(a.region) - ENGLISH_RELEASE_REGIONS.indexOf(b.region));
            return dates[0] || null;
        }

        function isStudioGrade(movie) {
            if (!movie || !movie.poster_path) return false;
            if (movie.original_language && movie.original_language !== 'en') return false;
            if (movie.runtime && movie.runtime < 70) return false;
            const companies = movie.production_companies || [];
            const hasMajorStudio = companies.some(c => MAJOR_STUDIO_IDS.has(Number(c.id)) || MAJOR_STUDIO_WORDS.test(c.name || ''));
            const hasKnownProvider = !!providerLine(movie);
            const popularity = movie.popularity || 0;
            const votes = movie.vote_count || 0;
            const hasBackdrop = !!movie.backdrop_path;
            const hasMoneySignal = (movie.budget || 0) >= 1000000 || (movie.revenue || 0) >= 1000000;
            if (hasMajorStudio) return true;
            if (hasKnownProvider && hasBackdrop && (popularity >= 8 || votes >= 20)) return true;
            if (hasKnownProvider && hasMoneySignal && (popularity >= 6 || votes >= 12)) return true;
            if (popularity >= 18 && votes >= 20 && hasBackdrop) return true;
            if (popularity >= 12 && votes >= 45) return true;
            if (votes >= 140 && (hasBackdrop || hasMoneySignal)) return true;
            return false;
        }

        function pickClearlogo(data) {
            const hd = data && (data.hdmovielogo || []);
            const sd = data && (data.movielogo || []);
            const byLikes = (a, b) => (parseInt(b.likes, 10) || 0) - (parseInt(a.likes, 10) || 0);
            const isEn = i => (i.lang || '').toLowerCase() === 'en';
            const best = hd.filter(isEn).sort(byLikes)[0] ||
                sd.filter(isEn).sort(byLikes)[0] ||
                hd.slice().sort(byLikes)[0] ||
                sd.slice().sort(byLikes)[0];
            return best ? best.url : '';
        }

        function fanartMovieId(movie) {
            return movie && movie.external_ids && movie.external_ids.imdb_id;
        }

        function fetchClearlogo(movie) {
            const movieId = fanartMovieId(movie);
            if (!movieId || !FANART_TV_API_KEY) return Promise.resolve('');
            const cacheKey = `fanart_logo_${movieId}`;
            const cached = cacheGet(cacheKey, LOGO_TTL);
            if (cached !== null) return Promise.resolve(cached);
            return new Promise(resolve => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: `https://webservice.fanart.tv/v3/movies/${encodeURIComponent(movieId)}?api_key=${encodeURIComponent(FANART_TV_API_KEY)}`,
                    timeout: 12000,
                    onload: r => {
                        let logo = '';
                        if (r.status >= 200 && r.status < 300) {
                            try { logo = pickClearlogo(JSON.parse(r.responseText || '{}')); } catch (e) { logo = ''; }
                        }
                        cacheSet(cacheKey, logo);
                        resolve(logo);
                    },
                    onerror: () => resolve(''),
                    ontimeout: () => resolve(''),
                });
            });
        }

        function addNav() {
            const list = document.querySelector('.main-menu__list');
            if (!list || document.getElementById('ptp-latest-digital-nav')) return;
            const item = el('li', { class: 'main-menu__item', id: 'ptp-latest-digital-nav' });
            const link = el('a', {
                class: 'main-menu__link ptp-ld-nav-link',
                href: '/index.php' + HASH,
                text: 'Latest Digital',
                onclick: e => {
                    if (/^\/(?:index\.php)?$/i.test(location.pathname) || location.pathname === '/') {
                        e.preventDefault();
                        history.pushState(null, '', HASH);
                        renderRoute();
                    }
                }
            });
            item.appendChild(link);
            list.appendChild(item);
            markActiveNav();
        }

        function markActiveNav() {
            const link = document.querySelector('#ptp-latest-digital-nav .main-menu__link');
            if (!link) return;
            link.classList.remove('main-menu__link--active');
            if (isLatestDigitalRoute()) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        }

        function getCanvas() {
            return document.querySelector('.main-column') ||
                document.querySelector('.main_column') ||
                document.querySelector('#content .thin') ||
                document.querySelector('#content') ||
                document.body;
        }

        function hideCanvas(host) {
            if (hiddenNodes.length) return;
            Array.from(host.children).forEach(child => {
                if (child.id === 'ptp-latest-digital-page' || child.classList.contains('sidebar')) return;
                hiddenNodes.push([child, child.style.display]);
                child.style.display = 'none';
            });
        }

        function restoreCanvas() {
            hiddenNodes.forEach(([node, display]) => { node.style.display = display; });
            hiddenNodes = [];
            const old = document.getElementById('ptp-latest-digital-page');
            if (old) old.remove();
        }

        function basePage(host) {
            hideCanvas(host);
            let page = document.getElementById('ptp-latest-digital-page');
            if (page) page.remove();
            page = el('section', { id: 'ptp-latest-digital-page', class: 'ptp-ld-page' });
            host.insertBefore(page, host.firstChild || null);
            return page;
        }

        function renderRoute() {
            markActiveNav();
            if (!isLatestDigitalRoute()) {
                document.body.classList.remove('ptp-latest-digital-active');
                restoreCanvas();
                return;
            }
            document.body.classList.add('ptp-latest-digital-active');
            const host = getCanvas();
            const page = basePage(host);
            if (!getKey()) {
                renderMissingKey(page);
                return;
            }
            const genres = selectedGenres();
            if (!genres.length) renderWizard(page, []);
            else renderLatest(page, genres);
        }

        function renderShell(page, subtitle) {
            page.innerHTML = '';
            const head = el('div', { class: 'ptp-ld-hero' },
                el('div', {},
                    el('h1', { text: 'Latest Digital' }),
                    el('p', { text: subtitle || `Digital releases filtered through TMDB for ${getRegionLabel()}.` })
                ),
                el('div', { class: 'ptp-ld-actions' },
                    el('button', { class: 'ptp-ld-button', type: 'button', text: 'Settings', onclick: () => renderWizard(page, selectedGenres()) }),
                    el('button', { class: 'ptp-ld-button ptp-ld-button-quiet', type: 'button', text: 'Refresh', onclick: () => { GM_deleteValue(KEY_CACHE); renderLatest(page, selectedGenres()); } })
                )
            );
            page.appendChild(head);
            return page;
        }

        function renderMissingKey(page) {
            renderShell(page, 'Set your TMDB key first, then choose the genres you want.');
            page.appendChild(el('div', { class: 'ptp-ld-empty' },
                el('h2', { text: 'TMDB key needed' }),
                el('p', { text: 'Latest Digital uses the same TMDB key as the rest of PTP Suite.' }),
                el('button', {
                    class: 'ptp-ld-button',
                    type: 'button',
                    text: 'Set TMDB API key',
                    onclick: () => {
                        const v = prompt('Enter your TMDB API key (v3) or Read-Access-Token (v4 - starts with "eyJ"):', getKey() || '');
                        if (v !== null) { GM_setValue('tmdb_key', v.trim()); renderRoute(); }
                    }
                })
            ));
        }

        async function getGenres() {
            const cacheKey = `genres_${getLang()}`;
            const cached = cacheGet(cacheKey, 30 * 24 * 3600e3);
            if (cached) return cached;
            const data = await tmdb('/genre/movie/list');
            const list = (data.genres || []).sort((a, b) => a.name.localeCompare(b.name));
            cacheSet(cacheKey, list);
            return list;
        }

        async function renderWizard(page, current) {
            renderShell(page, 'Pick the genres you want rows for. You can change this any time.');
            const panel = el('div', { class: 'ptp-ld-wizard' },
                el('h2', { text: 'Choose genres' }),
                el('p', { text: 'These are loaded from TMDB and saved in Tampermonkey storage.' }),
                el('div', { class: 'ptp-ld-status', text: 'Loading TMDB genres...' })
            );
            page.appendChild(panel);
            try {
                const genres = await getGenres();
                const selected = new Set((current || []).map(Number));
                const grid = el('div', { class: 'ptp-ld-genre-grid' });
                genres.forEach(g => {
                    const id = 'ptp-ld-genre-' + g.id;
                    grid.appendChild(el('label', { class: 'ptp-ld-genre', for: id },
                        el('input', { id, type: 'checkbox', value: String(g.id), checked: selected.has(g.id) ? 'checked' : null }),
                        el('span', { text: g.name })
                    ));
                });
                panel.innerHTML = '';
                panel.appendChild(el('h2', { text: 'Choose genres' }));
                panel.appendChild(grid);
                panel.appendChild(el('div', { class: 'ptp-ld-wizard-actions' },
                    el('button', {
                        class: 'ptp-ld-button',
                        type: 'button',
                        text: 'Save and load movies',
                        onclick: () => {
                            const ids = Array.from(grid.querySelectorAll('input:checked')).map(input => Number(input.value));
                            if (!ids.length) { alert('Pick at least one genre.'); return; }
                            saveGenres(ids);
                            renderLatest(page, ids);
                        }
                    }),
                    current && current.length ? el('button', { class: 'ptp-ld-button ptp-ld-button-quiet', type: 'button', text: 'Cancel', onclick: () => renderLatest(page, current) }) : null
                ));
            } catch (e) {
                panel.innerHTML = `<h2>Could not load genres</h2><p>${esc(e.message || e)}</p>`;
            }
        }

        async function getLatestForGenre(genre) {
            const preferredRegion = getRegion();
            const regions = Array.from(new Set([preferredRegion, ...ENGLISH_RELEASE_REGIONS]));
            const cacheKey = `row_curated3_english_${genre.id}_${preferredRegion}_${getLang()}`;
            const cached = cacheGet(cacheKey, CACHE_TTL);
            if (cached) return cached;

            const today = new Date();
            const start = new Date(today.getTime() - DAYS_BACK * 86400e3);
            const baseParams = {
                with_genres: String(genre.id),
                with_release_type: '4',
                with_original_language: 'en',
                'release_date.gte': dateStr(start),
                'release_date.lte': dateStr(today),
                sort_by: 'release_date.desc',
                'vote_count.gte': '10',
                include_adult: 'false',
                include_video: 'false',
                page: '1',
            };
            const requests = regions.flatMap(region => [1, 2].map(page => tmdb('/discover/movie', Object.assign({}, baseParams, { region, page })).catch(() => ({ results: [] }))));
            const pages = await Promise.all(requests);
            const seen = new Set();
            const candidates = pages.flatMap(p => p.results || [])
                .filter(m => m && m.id && !seen.has(m.id) && seen.add(m.id))
                .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
                .slice(0, 54);
            const checked = await Promise.all(candidates.map(async movie => {
                try {
                    const detail = await tmdb(`/movie/${movie.id}`, { append_to_response: 'release_dates,watch/providers' });
                    const digital = combinedDigitalRelease(detail.release_dates);
                    if (!digital) return null;
                    const merged = Object.assign({}, movie, detail, { digital_date: digital.iso, digital_region: digital.region });
                    return isStudioGrade(merged) ? merged : null;
                } catch (e) { return null; }
            }));
            const list = checked.filter(Boolean)
                .sort((a, b) => (b.digital_date || '').localeCompare(a.digital_date || '') || (b.popularity || 0) - (a.popularity || 0))
                .slice(0, PER_GENRE);
            cacheSet(cacheKey, list);
            return list;
        }

        async function renderLatest(page, genreIds) {
            const shell = renderShell(page, 'Combined English-language digital releases, filtered for recognisable releases.');
            const status = el('div', { class: 'ptp-ld-status', text: 'Loading genre rows...' });
            const rows = el('div', { class: 'ptp-ld-rows' });
            shell.appendChild(status);
            shell.appendChild(rows);
            try {
                const allGenres = await getGenres();
                const chosen = genreIds.map(id => allGenres.find(g => g.id === Number(id))).filter(Boolean);
                if (!chosen.length) {
                    renderWizard(page, []);
                    return;
                }
                status.textContent = `Loading ${chosen.length} genre ${chosen.length === 1 ? 'row' : 'rows'}...`;
                const usedIds = new Set();
                for (const genre of chosen) {
                    const section = renderRowShell(rows, genre);
                    const list = await getLatestForGenre(genre);
                    const unique = list.filter(movie => !usedIds.has(movie.id) && usedIds.add(movie.id));
                    fillRow(section, genre, unique);
                }
                status.remove();
            } catch (e) {
                status.classList.add('ptp-ld-error');
                status.textContent = 'Latest Digital failed: ' + (e.message || e);
            }
        }

        function renderRowShell(rows, genre) {
            const section = el('section', { class: 'ptp-ld-section' },
                el('div', { class: 'ptp-ld-section-head' },
                    el('h2', { text: genre.name }),
                    el('span', { text: 'curated digital releases' })
                ),
                el('div', { class: 'ptp-ld-strip' },
                    ...Array.from({ length: 8 }, () => el('div', { class: 'ptp-ld-skeleton' }))
                )
            );
            rows.appendChild(section);
            return section;
        }

        function fillRow(section, genre, list) {
            const strip = section.querySelector('.ptp-ld-strip');
            strip.innerHTML = '';
            if (!list.length) {
                strip.appendChild(el('div', { class: 'ptp-ld-row-empty', text: `No suitable English-language digital releases found for ${genre.name} yet.` }));
                return;
            }
            list.forEach(movie => strip.appendChild(movieCard(movie)));
        }

        function movieCard(movie) {
            const year = yearOf(movie.release_date);
            const card = el('button', {
                class: 'ptp-ld-card',
                type: 'button',
                title: `${movie.title}${year ? ' (' + year + ')' : ''}`,
                onclick: () => openDetails(movie.id, movie)
            },
                el('img', { src: posterUrl(movie, 'w342') || placeholder(movie.title), loading: 'lazy', alt: movie.title || '' }),
                el('span', { class: 'ptp-ld-date', text: shortDate(movie.digital_date) }),
                el('span', { class: 'ptp-ld-title', text: movie.title || 'Untitled' })
            );
            return card;
        }

        async function getDetails(id) {
            const cacheKey = `detail_combined_${id}_${getRegion()}_${getLang()}`;
            const cached = cacheGet(cacheKey, DETAIL_TTL);
            if (cached) return cached;
            const data = await tmdb(`/movie/${id}`, {
                append_to_response: 'credits,videos,release_dates,watch/providers,external_ids',
            });
            const digital = combinedDigitalRelease(data.release_dates);
            data.digital_date = digital && digital.iso;
            data.digital_region = digital && digital.region;
            cacheSet(cacheKey, data);
            return data;
        }

        function modalRoot() {
            let modal = document.getElementById('ptp-ld-modal');
            if (modal) return modal;
            modal = el('div', { id: 'ptp-ld-modal', class: 'ptp-ld-modal', role: 'dialog', 'aria-modal': 'true' });
            modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
            document.body.appendChild(modal);
            document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
            return modal;
        }

        function closeModal() {
            const modal = document.getElementById('ptp-ld-modal');
            if (modal) modal.classList.remove('is-open');
        }

        async function openDetails(id, seed) {
            const modal = modalRoot();
            modal.innerHTML = '<div class="ptp-ld-dialog"><div class="ptp-ld-status">Loading TMDB details...</div></div>';
            modal.classList.add('is-open');
            try {
                const movie = await getDetails(id);
                movie.clearlogo_url = await fetchClearlogo(movie);
                renderModal(modal, Object.assign({}, seed || {}, movie));
            } catch (e) {
                modal.innerHTML = `<div class="ptp-ld-dialog"><button class="ptp-ld-close" type="button" aria-label="Close">x</button><div class="ptp-ld-status ptp-ld-error">${esc(e.message || e)}</div></div>`;
                modal.querySelector('.ptp-ld-close').addEventListener('click', closeModal);
            }
        }

        function renderModal(modal, movie) {
            const year = yearOf(movie.release_date);
            const directors = ((movie.credits && movie.credits.crew) || []).filter(p => p.job === 'Director').map(p => p.name).slice(0, 3);
            const cast = ((movie.credits && movie.credits.cast) || []).slice(0, 8).map(p => p.name);
            const videos = ((movie.videos && movie.videos.results) || []).filter(v => v.site === 'YouTube');
            const trailer = videos.find(v => v.type === 'Trailer') || videos[0];
            const providers = providerLine(movie);
            const combinedDigital = combinedDigitalRelease(movie.release_dates) || {};
            const digital = movie.digital_date || combinedDigital.iso;
            const digitalRegion = movie.digital_region || combinedDigital.region;
            const ptpUrl = ptpSearch(movie.title, year);
            modal.innerHTML = '';
            const dialog = el('div', { class: 'ptp-ld-dialog' });
            if (backdropUrl(movie)) dialog.style.setProperty('--ptp-ld-backdrop', `url("${backdropUrl(movie)}")`);
            dialog.appendChild(el('button', { class: 'ptp-ld-close', type: 'button', 'aria-label': 'Close', text: 'x', onclick: closeModal }));
            dialog.appendChild(el('div', { class: 'ptp-ld-dialog-bg' }));
            const body = el('div', { class: 'ptp-ld-dialog-body' },
                el('img', { class: 'ptp-ld-dialog-poster', src: posterUrl(movie, 'w342') || placeholder(movie.title), alt: movie.title || '' }),
                el('div', { class: 'ptp-ld-dialog-copy' },
                    movie.clearlogo_url ? el('img', { class: 'ptp-ld-clearlogo', src: movie.clearlogo_url, alt: movie.title || 'Clearlogo', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
                    el('div', { class: 'ptp-ld-kicker', text: digital ? `Digital ${shortDate(digital)} - ${regionLabel(digitalRegion || getRegion())}` : 'English digital release' }),
                    el('h2', { text: `${movie.title || 'Untitled'}${year ? ' (' + year + ')' : ''}` }),
                    movie.tagline ? el('p', { class: 'ptp-ld-tagline', text: movie.tagline }) : null,
                    el('div', { class: 'ptp-ld-meta', text: metaLine(movie, directors) }),
                    movie.overview ? el('p', { class: 'ptp-ld-overview', text: movie.overview }) : null,
                    chipRow((movie.genres || []).map(g => g.name)),
                    providers ? el('p', { class: 'ptp-ld-small', text: providers }) : null,
                    cast.length ? el('p', { class: 'ptp-ld-small', text: 'Cast: ' + cast.join(', ') }) : null,
                    el('div', { class: 'ptp-ld-modal-actions' },
                        el('a', { class: 'ptp-ld-button', href: ptpUrl, text: 'View on PTP' }),
                        el('a', { class: 'ptp-ld-button ptp-ld-button-quiet', href: `https://www.themoviedb.org/movie/${movie.id}`, target: '_blank', rel: 'noopener', text: 'TMDB' }),
                        trailer ? el('a', { class: 'ptp-ld-button ptp-ld-button-quiet', href: `https://www.youtube.com/watch?v=${trailer.key}`, target: '_blank', rel: 'noopener', text: 'Trailer' }) : null
                    )
                )
            );
            dialog.appendChild(body);
            modal.appendChild(dialog);
        }

        function metaLine(movie, directors) {
            const bits = [];
            if (movie.runtime) bits.push(`${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m`);
            if (typeof movie.vote_average === 'number' && movie.vote_average > 0) bits.push(`TMDB ${movie.vote_average.toFixed(1)} (${(movie.vote_count || 0).toLocaleString()})`);
            if (directors && directors.length) bits.push('Directed by ' + directors.join(', '));
            return bits.join(' - ');
        }

        function chipRow(items) {
            const wrap = el('div', { class: 'ptp-ld-chips' });
            (items || []).filter(Boolean).forEach(item => wrap.appendChild(el('span', { text: item })));
            return wrap;
        }

        function providerLine(movie) {
            const wp = movie['watch/providers'] && movie['watch/providers'].results;
            if (!wp) return '';
            const regions = Array.from(new Set([getRegion(), ...ENGLISH_RELEASE_REGIONS]));
            const code = regions.find(r => wp[r] && ['flatrate', 'rent', 'buy'].some(k => (wp[r][k] || []).length));
            const region = code && wp[code];
            if (!region) return '';
            const names = ['flatrate', 'rent', 'buy'].flatMap(k => region[k] || []).map(p => p.provider_name);
            return names.length ? `Watch options (${regionLabel(code)}): ` + Array.from(new Set(names)).slice(0, 8).join(', ') : '';
        }

        GM_addStyle(`
        body.ptp-latest-digital-active .sidebar{display:none !important}
        body.ptp-latest-digital-active .main-column,
        body.ptp-latest-digital-active .main_column{width:auto !important;max-width:none !important;margin-right:0 !important;overflow:visible !important}
        body.ptp-latest-digital-active #content .thin{max-width:none !important}
        #ptp-latest-digital-nav .ptp-ld-nav-link,
        #ptp-latest-digital-nav .ptp-ld-nav-link[aria-current="page"]{border-color:transparent !important;background:rgba(255,255,255,.045) !important;box-shadow:inset 0 0 16px rgba(255,255,255,.025) !important;outline:0 !important}
        #ptp-latest-digital-nav .ptp-ld-nav-link:hover{border-color:transparent !important;background:rgba(255,255,255,.075) !important;box-shadow:inset 0 0 18px rgba(255,255,255,.045) !important}
        #ptp-latest-digital-nav .ptp-ld-nav-link::before,
        #ptp-latest-digital-nav .ptp-ld-nav-link[aria-current="page"]::before{transform:scaleX(0) !important;opacity:.28 !important}
        .ptp-ld-page{display:block !important;width:100%;max-width:none;margin:0 auto 24px;color:#dce6f3;font-family:Inter,"Open Sans",Arial,sans-serif}
        .ptp-ld-page *{box-sizing:border-box}
        .ptp-ld-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin:0 0 16px;padding:18px 0 14px;border-bottom:1px solid rgba(120,183,255,.18)}
        .ptp-ld-hero h1{margin:0;color:#fff;font:400 2.1rem/1 Impact,"Arial Black",sans-serif;letter-spacing:.03em}
        .ptp-ld-hero p{margin:6px 0 0;color:#98a7bb;font-size:.9rem}
        .ptp-ld-actions,.ptp-ld-wizard-actions,.ptp-ld-modal-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
        .ptp-ld-button{display:inline-flex !important;align-items:center !important;justify-content:center !important;min-height:34px !important;padding:8px 13px !important;border:1px solid rgba(75,156,255,.42) !important;border-radius:6px !important;background:#1b63ad !important;color:#fff !important;box-shadow:none !important;font-family:Inter,"Open Sans",Arial,sans-serif !important;font-weight:800 !important;font-size:.82rem !important;line-height:1.1 !important;text-decoration:none !important;cursor:pointer !important}
        .ptp-ld-button:hover{background:#2477cf !important;color:#fff !important}
        .ptp-ld-button-quiet{border-color:rgba(157,169,189,.24) !important;background:#141a23 !important;color:#dce6f3 !important}
        .ptp-ld-button-quiet:hover{background:#1b2330 !important}
        .ptp-ld-status,.ptp-ld-empty,.ptp-ld-wizard{padding:16px;border:1px solid rgba(120,183,255,.18);border-radius:8px;background:#101620;color:#9da9bd}
        .ptp-ld-empty h2,.ptp-ld-wizard h2{margin:0 0 8px;color:#fff}
        .ptp-ld-error{border-color:rgba(255,91,79,.42);color:#ffb1aa}
        .ptp-ld-genre-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:8px;margin:12px 0}
        .ptp-ld-genre{display:flex;align-items:center;gap:8px;min-height:36px;padding:8px 10px;border:1px solid rgba(157,169,189,.18);border-radius:6px;background:#0c1119;color:#dce6f3;cursor:pointer}
        .ptp-ld-genre:hover{border-color:rgba(75,156,255,.48);background:#121a27}
        .ptp-ld-genre input{width:15px;height:15px;margin:0;accent-color:#4b9cff}
        .ptp-ld-rows{display:grid;gap:22px}
        .ptp-ld-section{min-width:0;padding-top:2px}
        .ptp-ld-section-head{display:flex;align-items:baseline;gap:10px;margin:0 0 10px}
        .ptp-ld-section-head h2{margin:0;color:#fff;font-size:1.04rem;line-height:1.2}
        .ptp-ld-section-head span{color:#748095;font-size:.78rem}
        .ptp-ld-strip{display:grid;grid-auto-flow:column;grid-auto-columns:128px;gap:13px;overflow-x:auto;overflow-y:hidden;padding:3px 3px 12px;scrollbar-width:thin}
        .ptp-ld-strip::-webkit-scrollbar{height:8px}
        .ptp-ld-strip::-webkit-scrollbar-thumb{background:#2a3948;border-radius:999px}
        .ptp-ld-card{appearance:none !important;position:relative !important;display:block !important;width:128px !important;min-width:0 !important;margin:0 !important;padding:0 !important;border:0 !important;border-radius:0 !important;background:transparent !important;color:#dce6f3 !important;box-shadow:none !important;text-align:left !important;text-shadow:none !important;font-family:Inter,"Open Sans",Arial,sans-serif !important;font-size:.78rem !important;line-height:1.22 !important;cursor:pointer !important;overflow:visible !important}
        .ptp-ld-card img,.ptp-ld-skeleton{display:block !important;width:100% !important;aspect-ratio:2/3;border-radius:7px;background:#141a23;object-fit:cover;box-shadow:0 8px 20px rgba(0,0,0,.26)}
        .ptp-ld-card:hover img{outline:2px solid #4b9cff;outline-offset:2px}
        .ptp-ld-card:focus-visible{outline:2px solid #4b9cff !important;outline-offset:4px !important}
        .ptp-ld-date{position:absolute;left:7px;top:7px;max-width:calc(100% - 14px);padding:3px 7px;border-radius:5px;background:rgba(3,8,14,.84);color:#eaf2ff;font-size:.67rem;font-weight:900;line-height:1.05}
        .ptp-ld-title{display:-webkit-box !important;margin-top:7px !important;color:#dce6f3 !important;font-size:.76rem !important;font-weight:800 !important;line-height:1.22 !important;overflow:hidden !important;-webkit-line-clamp:2;-webkit-box-orient:vertical}
        .ptp-ld-skeleton{animation:ptp-ld-pulse 1.4s ease-in-out infinite}
        .ptp-ld-row-empty{grid-column:1/-1;padding:14px;border:1px dashed rgba(157,169,189,.22);border-radius:8px;color:#8896aa}
        .ptp-ld-modal{position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;padding:22px;background:rgba(2,5,9,.76)}
        .ptp-ld-modal.is-open{display:flex}
        .ptp-ld-dialog{position:relative;width:min(900px,94vw);max-height:90vh;overflow:auto;border:1px solid rgba(120,183,255,.24);border-radius:10px;background:#0b111a;color:#dce6f3;box-shadow:0 20px 60px rgba(0,0,0,.7)}
        .ptp-ld-dialog-bg{position:absolute;inset:0;background:linear-gradient(90deg,rgba(7,12,18,.98),rgba(7,12,18,.88) 48%,rgba(7,12,18,.68)),var(--ptp-ld-backdrop,none) center/cover no-repeat;opacity:.95}
        .ptp-ld-dialog-body{position:relative;display:grid;grid-template-columns:190px minmax(0,1fr);gap:20px;padding:24px}
        .ptp-ld-dialog-poster{width:190px;aspect-ratio:2/3;object-fit:cover;border-radius:8px;box-shadow:0 12px 28px rgba(0,0,0,.45)}
        .ptp-ld-clearlogo{display:block;max-width:min(360px,100%);max-height:96px;object-fit:contain;margin:0 0 12px;filter:drop-shadow(0 4px 14px rgba(0,0,0,.72))}
        .ptp-ld-dialog-copy h2{margin:0 0 8px;color:#fff;font:400 2rem/1.05 Impact,"Arial Black",sans-serif;letter-spacing:.02em}
        .ptp-ld-kicker{margin-bottom:7px;color:#78b7ff;font-size:.78rem;font-weight:900;text-transform:uppercase;letter-spacing:.08em}
        .ptp-ld-tagline{margin:0 0 8px;color:#c8d3e2;font-style:italic}
        .ptp-ld-meta,.ptp-ld-small{color:#aebbd0;font-size:.86rem;line-height:1.5}
        .ptp-ld-overview{max-width:68ch;color:#e8eef7;font-size:.94rem;line-height:1.55}
        .ptp-ld-chips{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
        .ptp-ld-chips span{padding:4px 8px;border:1px solid rgba(120,183,255,.24);border-radius:999px;background:rgba(75,156,255,.1);font-size:.75rem;font-weight:800}
        .ptp-ld-close{position:absolute;right:12px;top:10px;z-index:3;width:32px;height:32px;border:1px solid rgba(255,255,255,.18);border-radius:6px;background:rgba(7,12,18,.72);color:#fff;font-weight:900;cursor:pointer}
        @keyframes ptp-ld-pulse{0%,100%{opacity:.58}50%{opacity:1}}
        @media (max-width:720px){
          .ptp-ld-hero{align-items:flex-start;flex-direction:column}
          .ptp-ld-strip{grid-auto-columns:minmax(104px,38vw)}
          .ptp-ld-dialog-body{grid-template-columns:1fr;padding:18px}
          .ptp-ld-dialog-poster{width:min(190px,52vw)}
        }
        `);

        addNav();
        renderRoute();
        window.addEventListener('hashchange', renderRoute);
        window.addEventListener('popstate', renderRoute);
    })();
    }

    /* ================================================================== *
     *  PTP Top 10 - Single Row Posters v1.0  --  top10.php
     * ================================================================== */
    function MOD_top10SingleRow() {
    (function () {
      'use strict';

      const GAP = 8;        // px gap between posters
      const PER_ROW = 10;   // posters per row

      const css = `
        .cover-movie-list {
          display: flex !important;
          flex-wrap: nowrap !important;
          gap: ${GAP}px !important;
          align-items: flex-start !important;
        }
        .cover-movie-list__movie {
          width: calc((100% - ${PER_ROW - 1} * ${GAP}px) / ${PER_ROW}) !important;
          min-width: 0 !important;
          margin: 0 !important;
          flex: 0 0 auto !important;
        }
        /* The poster is a fixed 190x296 background image; make it scale to the tile
           while preserving its aspect ratio. */
        .cover-movie-list__movie__cover-link {
          display: block !important;
          width: 100% !important;
          height: auto !important;
          aspect-ratio: 190 / 296 !important;
          background-size: cover !important;
          background-position: center !important;
        }
      `;

      const style = document.createElement('style');
      style.id = 'ptp-top10-single-row';
      style.textContent = css;

      (document.head || document.documentElement).appendChild(style);
    })();
    }

    /* ================================================================== *
     *  PTP TMDB Enricher v1.2.0  --  torrents.php + homepage
     * ================================================================== */
    function MOD_tmdbEnricher() {
    /* eslint-disable no-console */
    (function () {
        'use strict';

        /* ------------------------------------------------------------------ *
         *  CONFIG                                                            *
         * ------------------------------------------------------------------ *
         *  You need a free TMDB API key (v3) or Read-Access-Token (v4).       *
         *  Get one at https://www.themoviedb.org/settings/api                 *
         *  The script will prompt you the first time. You can change it later *
         *  from the Tampermonkey menu -> "Set TMDB API key".                  *
         * ------------------------------------------------------------------ */

        const IMG = 'https://image.tmdb.org/t/p/';       // TMDB image CDN base
        const API = 'https://api.themoviedb.org/3';       // TMDB API v3 base
        const LOG = (...a) => console.log('%c[PTP-TMDB]', 'color:#ffd54f', ...a);

        let TMDB_KEY = GM_getValue('tmdb_key', '');
        let REGION   = PTPSuite.tmdbRegion();              // watch-provider / release-cert region
        let LANG     = PTPSuite.tmdbLang();

        /* ------------------------------------------------------------------ *
         *  MENU COMMANDS  -- registered once in the shared prelude above, so the
         *  key / region / language menu entries exist on every PTP page rather
         *  than only the ones this module runs on. They write the same
         *  GM storage keys this module reads (tmdb_key / tmdb_region / tmdb_lang).
         * ------------------------------------------------------------------ */

        /* ------------------------------------------------------------------ *
         *  NETWORKING                                                         *
         * ------------------------------------------------------------------ */
        function tmdb(path, params = {}) {
            const usp = new URLSearchParams(params);
            usp.set('language', LANG);
            const isV4 = TMDB_KEY.startsWith('eyJ');
            if (!isV4) usp.set('api_key', TMDB_KEY);
            const url = `${API}${path}?${usp.toString()}`;
            const headers = { 'Content-Type': 'application/json;charset=utf-8' };
            if (isV4) headers['Authorization'] = `Bearer ${TMDB_KEY}`;
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET', url, headers,
                    onload: (r) => {
                        try {
                            const j = JSON.parse(r.responseText);
                            if (r.status >= 200 && r.status < 300) resolve(j);
                            else reject(new Error(j.status_message || `HTTP ${r.status}`));
                        } catch (e) { reject(e); }
                    },
                    onerror: () => reject(new Error('network error')),
                    ontimeout: () => reject(new Error('timeout')),
                    timeout: 20000,
                });
            });
        }

        /* ------------------------------------------------------------------ *
         *  HELPERS                                                            *
         * ------------------------------------------------------------------ */
        const el = (tag, attrs = {}, ...kids) => {
            const n = document.createElement(tag);
            for (const [k, v] of Object.entries(attrs)) {
                if (k === 'class') n.className = v;
                else if (k === 'html') n.innerHTML = v;
                else if (k === 'text') n.textContent = v;
                else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
                else if (v !== null && v !== undefined) n.setAttribute(k, v);
            }
            for (const kid of kids) if (kid) n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
            return n;
        };
        const money = (n) => (typeof n === 'number' && n > 0) ? '$' + n.toLocaleString('en-US') : null;
        const mins  = (n) => (typeof n === 'number' && n > 0) ? `${Math.floor(n / 60)}h ${n % 60}m (${n} min)` : null;
        const pct   = (n) => Math.round((n || 0) * 10);
        const yearOf = (d) => (d && /^\d{4}/.test(d)) ? d.slice(0, 4) : '';

        function getImdbId() {
            // 1) Any IMDb title link on the page
            const a = document.querySelector('a[href*="imdb.com/title/tt"]');
            if (a) { const m = a.href.match(/tt\d{6,}/); if (m) return m[0]; }
            // 2) Raw text anywhere (some layouts print the id)
            const m = document.body.innerHTML.match(/tt\d{7,}/);
            return m ? m[0] : null;
        }

        // A PTP-styled box we can drop into the sidebar or main column
        function box(title, opts = {}) {
            const head = el('div', { class: 'box_head tmdb-head' },
                el('span', { class: 'tmdb-head-title', html: title }));
            if (opts.right) head.appendChild(el('span', { class: 'tmdb-head-right', html: opts.right }));
            const body = el('div', { class: 'tmdb-body' });
            const b = el('div', { class: 'box tmdb-box' + (opts.cls ? ' ' + opts.cls : '') }, head, body);

            if (opts.collapsible) {
                head.classList.add('tmdb-collapsible');
                const chev = el('span', { class: 'tmdb-chev' });
                head.insertBefore(chev, head.firstChild);
                const key = 'ptp_collapse_' + (opts.key || title.replace(/<[^>]*>/g, '').replace(/[^a-z0-9]+/gi, '_').toLowerCase());
                let collapsed = GM_getValue(key, !!opts.collapsed);   // remembers your last choice
                const apply = () => { body.style.display = collapsed ? 'none' : ''; chev.textContent = collapsed ? '▸' : '▾'; };
                head.addEventListener('click', () => { collapsed = !collapsed; GM_setValue(key, collapsed); apply(); });
                apply();
            }
            return { box: b, body };
        }

        /* ------------------------------------------------------------------ *
         *  STYLES                                                             *
         * ------------------------------------------------------------------ */
        GM_addStyle(`
        .tmdb-box{margin-bottom:12px;overflow:hidden}
        .tmdb-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
        .tmdb-head-title{font-weight:700}
        .tmdb-head-title .tmdb-logo{color:#01b4e4;font-weight:800;letter-spacing:.5px}
        .tmdb-head-right{font-size:11px;color:#9aa;opacity:.9}
        .tmdb-head.tmdb-collapsible{cursor:pointer;user-select:none}
        .tmdb-head.tmdb-collapsible:hover .tmdb-head-title{color:#01b4e4}
        .tmdb-chev{display:inline-block;width:1em;margin-right:3px;color:#01b4e4;font-size:11px}
        .tmdb-body{padding:10px 12px}
        .tmdb-muted{color:#8b95a1}
        .tmdb-chip{display:inline-block;padding:3px 9px;margin:3px 4px 3px 0;border-radius:20px;
            background:linear-gradient(135deg,#0d2b3e,#123a52);border:1px solid #1f4a63;color:#cfe8f5;font-size:12px;text-decoration:none}
        a.tmdb-chip:hover{background:#01b4e4;color:#04121a;border-color:#01b4e4}
        /* Hero */
        .tmdb-hero{position:relative;border-radius:8px;overflow:hidden;margin-bottom:14px;min-height:230px;
            background:#0b0f14 center/cover no-repeat;box-shadow:0 2px 14px rgba(0,0,0,.5)}
        .tmdb-hero-shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,12,16,.94) 0%,rgba(8,12,16,.72) 45%,rgba(8,12,16,.35) 100%)}
        .tmdb-hero-in{position:relative;display:flex;gap:16px;padding:18px 20px}
        .tmdb-hero-poster{width:120px;flex:0 0 120px;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.6)}
        .tmdb-hero-meta{flex:1;min-width:0}
        .tmdb-hero-title{font-size:22px;font-weight:800;margin:0 0 2px;color:#fff;text-shadow:0 1px 3px #000}
        .tmdb-hero-tag{font-style:italic;color:#c9d4de;margin:2px 0 8px;text-shadow:0 1px 2px #000}
        .tmdb-hero-facts{color:#dfe7ee;font-size:13px;margin-bottom:8px;display:flex;align-items:center;flex-wrap:wrap;gap:0 12px}
        .tmdb-hero-facts span{white-space:nowrap}
        .tmdb-bbfc{display:inline-flex;align-items:center}
        .tmdb-bbfc svg{display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.65))}
        .tmdb-hero-overview{color:#e8eef3;font-size:13px;line-height:1.5;max-height:6.5em;overflow:hidden}
        /* Relocated PTP ratings, pinned top-right of hero */
        .tmdb-hero-ratings{position:absolute;top:14px;right:16px;z-index:2;display:flex;flex-wrap:wrap;
            justify-content:flex-end;align-items:center;gap:8px 16px;max-width:56%;
            background:none;border:0;padding:0}
        .tmdb-hero-ratings *{font-size:13px !important;line-height:1.3 !important;color:#e8eef3 !important;text-shadow:0 1px 2px #000}
        .tmdb-hero-ratings a{color:#dfe7ee !important}
        .tmdb-hero-ratings img{max-height:34px !important;width:auto !important;vertical-align:middle;margin:0}
        /* Score ring */
        .tmdb-score{display:inline-flex;align-items:center;gap:8px;margin:2px 0 8px}
        .tmdb-ring{--v:0;width:52px;height:52px;border-radius:50%;display:grid;place-items:center;font-weight:800;color:#fff;
            background:radial-gradient(closest-side,#0b1620 79%,transparent 80% 100%),conic-gradient(var(--c) calc(var(--v)*1%),#233 0);
            font-size:14px}
        .tmdb-ring small{font-size:8px;margin-top:-2px}
        .tmdb-score-votes{font-size:12px;color:#9aa}
        /* Facts table */
        .tmdb-facts{width:100%;border-collapse:collapse;font-size:13px}
        .tmdb-facts td{padding:5px 4px;vertical-align:top;border-bottom:1px solid rgba(255,255,255,.06)}
        .tmdb-facts td.k{color:#8b95a1;white-space:nowrap;width:42%}
        .tmdb-facts tr:last-child td{border-bottom:0}
        /* Horizontal scroller (cast / similar / gallery) */
        .tmdb-scroller{display:flex;gap:10px;overflow-x:auto;padding-bottom:8px;scrollbar-width:thin}
        .tmdb-scroller::-webkit-scrollbar{height:8px}
        .tmdb-scroller::-webkit-scrollbar-thumb{background:#2a3948;border-radius:8px}
        .tmdb-card{flex:0 0 auto;width:104px;text-align:center;text-decoration:none;color:#dfe7ee}
        .tmdb-card img{width:104px;height:156px;object-fit:cover;border-radius:6px;background:#182430;display:block}
        .tmdb-card .nm{font-size:12px;font-weight:600;margin-top:5px;line-height:1.25}
        .tmdb-card .sub{font-size:11px;color:#8b95a1;line-height:1.2}
        .tmdb-card:hover img{outline:2px solid #01b4e4}
        /* Trailer strip */
        .tmdb-vid{position:relative;flex:0 0 auto;width:210px;text-decoration:none}
        .tmdb-vid img{width:210px;height:118px;object-fit:cover;border-radius:6px;display:block}
        .tmdb-vid .play{position:absolute;inset:0;display:grid;place-items:center;font-size:34px;color:#fff;text-shadow:0 2px 6px #000}
        .tmdb-vid .cap{font-size:11px;color:#cfe8f5;margin-top:4px;line-height:1.25}
        /* Gallery */
        .tmdb-gal img{height:118px;border-radius:6px;cursor:zoom-in;display:block}
        /* Providers */
        .tmdb-prov{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
        .tmdb-prov .grp{font-size:11px;color:#8b95a1;width:100%;margin-top:4px}
        .tmdb-prov img{width:38px;height:38px;border-radius:8px}
        /* Links row */
        .tmdb-links a{display:inline-block;margin:3px 6px 3px 0}
        /* Even out PTP's native link bar so bottom padding matches the top */
        .linkbox{padding-bottom:10px !important}
        /* Lightbox */
        #tmdb-lb{position:fixed;inset:0;z-index:99999;background:rgba(2,5,8,.92);display:none;place-items:center;cursor:zoom-out}
        #tmdb-lb.on{display:grid}
        #tmdb-lb img{max-width:94vw;max-height:94vh;border-radius:6px;box-shadow:0 6px 40px #000}
        .tmdb-loading{color:#8b95a1;font-size:12px;padding:6px 2px}
        `);

        // Lightbox element
        const lb = el('div', { id: 'tmdb-lb', onclick: () => lb.classList.remove('on') }, el('img'));
        document.body.appendChild(lb);
        const openLB = (src) => { lb.querySelector('img').src = src; lb.classList.add('on'); };

        /* ------------------------------------------------------------------ *
         *  INSERTION POINTS                                                   *
         * ------------------------------------------------------------------ */
        const sidebar = document.querySelector('.sidebar') || document.querySelector('#content .thin > div:first-child');
        const main    = document.querySelector('.main_column') || document.querySelector('#content .thin');

        function addSidebar(node, top = false) {
            if (!sidebar) { addMain(node); return; }
            if (top && sidebar.firstChild) sidebar.insertBefore(node, sidebar.firstChild);
            else sidebar.appendChild(node);
        }
        function addMain(node, top = false) {
            const host = main || document.body;
            if (top && host.firstChild) host.insertBefore(node, host.firstChild);
            else host.appendChild(node);
        }

        /* ------------------------------------------------------------------ *
         *  RENDERERS                                                          *
         * ------------------------------------------------------------------ */
        function renderHero(m) {
            const back = m.backdrop_path ? `${IMG}w1280${m.backdrop_path}` : '';
            const hero = el('div', { class: 'tmdb-hero', style: back ? `background-image:url('${back}')` : '' });
            hero.appendChild(el('div', { class: 'tmdb-hero-shade' }));
            hero.appendChild(el('div', { id: 'tmdb-hero-ratings', class: 'tmdb-hero-ratings' }));
            const inner = el('div', { class: 'tmdb-hero-in' });

            if (m.poster_path)
                inner.appendChild(el('img', { class: 'tmdb-hero-poster', src: `${IMG}w342${m.poster_path}`, loading: 'lazy' }));

            const meta = el('div', { class: 'tmdb-hero-meta' });
            meta.appendChild(el('div', { class: 'tmdb-hero-title', text: `${m.title}${yearOf(m.release_date) ? ' (' + yearOf(m.release_date) + ')' : ''}` }));
            if (m.original_title && m.original_title !== m.title)
                meta.appendChild(el('div', { class: 'tmdb-hero-tag', text: m.original_title }));
            if (m.tagline) meta.appendChild(el('div', { class: 'tmdb-hero-tag', text: '“' + m.tagline + '”' }));

            // score + quick facts line
            const score = scoreRing(m.vote_average, m.vote_count);
            const facts = el('div', { class: 'tmdb-hero-facts' });
            const gbCert = getCertFor(m, 'GB');          // UK rating for the badge
            const cert = getCert(m);                       // fallback (region/US) as text
            const bits = [];
            if (!gbCert && cert) bits.push(`🔖 ${cert}`);
            if (m.runtime) bits.push(`⏱ ${Math.floor(m.runtime / 60)}h ${m.runtime % 60}m`);
            if (m.release_date) bits.push(`📅 ${m.release_date}`);
            if (m.status && m.status !== 'Released') bits.push(`⚙ ${m.status}`);
            if (typeof m.popularity === 'number') bits.push(`🔥 ${Math.round(m.popularity)}`);
            if (gbCert) facts.appendChild(bbfcBadge(gbCert));   // real BBFC symbol first
            bits.forEach(b => facts.appendChild(el('span', { text: b })));

            const scoreWrap = el('div', {}, score);
            meta.appendChild(scoreWrap);
            meta.appendChild(facts);

            // genres
            if (m.genres && m.genres.length) {
                const g = el('div', {});
                m.genres.forEach(x => g.appendChild(el('span', { class: 'tmdb-chip', text: x.name })));
                meta.appendChild(g);
            }
            if (m.overview) meta.appendChild(el('div', { class: 'tmdb-hero-overview', text: m.overview }));

            inner.appendChild(meta);
            hero.appendChild(inner);
            addMain(hero, true);
        }

        function scoreRing(avg, votes) {
            const v = pct(avg);
            const c = v >= 70 ? '#21d07a' : v >= 40 ? '#d2d531' : '#db2360';
            const wrap = el('div', { class: 'tmdb-score' });
            const ring = el('div', { class: 'tmdb-ring', style: `--v:${v};--c:${c}` },
                el('span', {}, document.createTextNode(v ? v + '' : 'NR'),
                    v ? el('small', { text: '%' }) : null));
            wrap.appendChild(ring);
            wrap.appendChild(el('div', { class: 'tmdb-score-votes', html: `<b style="color:#01b4e4">TMDB</b><br>${votes ? votes.toLocaleString() + ' votes' : 'no votes'}` }));
            return wrap;
        }

        function getCertFor(m, region) {
            try {
                const list = (m.release_dates && m.release_dates.results) || [];
                const r = list.find(x => x.iso_3166_1 === region);
                if (!r) return '';
                const withCert = r.release_dates.filter(d => d.certification && d.certification.trim());
                return (withCert[0] || {}).certification || '';
            } catch (e) { return ''; }
        }
        function getCert(m) { return getCertFor(m, REGION) || getCertFor(m, 'US'); }

        // Recreated BBFC (UK) age-rating symbol as inline SVG — official brand colours, white category text
        function bbfcBadge(cert) {
            const c = String(cert).toUpperCase();
            const colour = {
                'U': '#1f9e4a', 'PG': '#f5a300', '12': '#f07d00', '12A': '#f07d00',
                '15': '#c6007e', '18': '#d7191c', 'R18': '#a3000f'
            }[c] || '#5a6b78';
            const fs = c.length >= 3 ? 32 : (c.length === 2 ? 46 : 56);
            const svg =
                `<svg width="36" height="36" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="BBFC ${c}">
                   <circle cx="50" cy="50" r="49" fill="${colour}"/>
                   <circle cx="50" cy="50" r="49" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="4"/>
                   <text x="50" y="53" text-anchor="middle" dominant-baseline="middle"
                         font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${fs}" fill="#fff">${c}</text>
                 </svg>`;
            return el('span', { class: 'tmdb-bbfc', title: `BBFC ${c} (UK)`, html: svg });
        }

        function renderRatingsBox(m) {
            const { box: b, body } = box('<span class="tmdb-logo">TMDB</span> Rating & Facts');
            body.appendChild(scoreRing(m.vote_average, m.vote_count));

            const rows = [];
            const cert = getCert(m);
            const dir = (m.credits && m.credits.crew || []).filter(c => c.job === 'Director').map(c => c.name).join(', ');
            rows.push(['Status', m.status]);
            rows.push(['Original title', (m.original_title !== m.title) ? m.original_title : null]);
            rows.push(['Director', dir]);
            rows.push(['Runtime', mins(m.runtime)]);
            rows.push(['Release', m.release_date]);
            rows.push(['Certification', cert]);
            rows.push(['Original language', (m.original_language || '').toUpperCase()]);
            rows.push(['Budget', money(m.budget)]);
            rows.push(['Revenue', money(m.revenue)]);
            if (m.budget > 0 && m.revenue > 0) rows.push(['Profit', money(m.revenue - m.budget)]);
            rows.push(['Popularity', typeof m.popularity === 'number' ? Math.round(m.popularity) : null]);
            if (m.belongs_to_collection) rows.push(['Collection', m.belongs_to_collection.name]);

            const tbl = el('table', { class: 'tmdb-facts' });
            rows.filter(r => r[1]).forEach(([k, v]) =>
                tbl.appendChild(el('tr', {}, el('td', { class: 'k', text: k }), el('td', { text: String(v) }))));
            body.appendChild(tbl);
            addSidebar(b, true);
        }

        function renderCast(m) {
            const cast = (m.credits && m.credits.cast) || [];
            if (!cast.length) return;
            const { box: b, body } = box(`Top Cast <span class="tmdb-muted">· ${cast.length}</span>`);
            const s = el('div', { class: 'tmdb-scroller' });
            cast.slice(0, 25).forEach(p => {
                const img = p.profile_path ? `${IMG}w185${p.profile_path}` : placeholder(p.name);
                s.appendChild(el('a', { class: 'tmdb-card', href: ptpArtistSearch(p.name), target: '_blank', rel: 'noopener' },
                    el('img', { src: img, loading: 'lazy', alt: p.name }),
                    el('div', { class: 'nm', text: p.name }),
                    el('div', { class: 'sub', text: p.character || '' })));
            });
            body.appendChild(s);

            // key crew line
            const crew = (m.credits && m.credits.crew) || [];
            const wanted = ['Director', 'Screenplay', 'Writer', 'Director of Photography', 'Original Music Composer', 'Editor', 'Producer'];
            const seen = new Set();
            const crewBits = [];
            wanted.forEach(job => {
                crew.filter(c => c.job === job).slice(0, 2).forEach(c => {
                    const key = job + c.id; if (seen.has(key)) return; seen.add(key);
                    crewBits.push(`<b>${job}:</b> ${c.name}`);
                });
            });
            if (crewBits.length)
                body.appendChild(el('div', { class: 'tmdb-muted', style: 'font-size:12px;margin-top:8px;line-height:1.7', html: crewBits.join(' &nbsp;·&nbsp; ') }));
            addMain(b);
        }

        function placeholder(name) {
            const initials = (name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
            const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='185' height='278'><rect width='100%' height='100%' fill='#182430'/><text x='50%' y='50%' fill='#3d5165' font-size='64' font-family='sans-serif' text-anchor='middle' dominant-baseline='central'>${initials}</text></svg>`;
            return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
        }

        function renderTrailers(m) {
            const vids = ((m.videos && m.videos.results) || [])
                .filter(v => v.site === 'YouTube')
                .sort((a, b) => (b.official - a.official) || (a.type === 'Trailer' ? -1 : 1));
            if (!vids.length) return;
            const { box: b, body } = box('🎬 Videos & Trailers');
            const s = el('div', { class: 'tmdb-scroller' });
            vids.slice(0, 12).forEach(v => {
                s.appendChild(el('a', { class: 'tmdb-vid', href: `https://www.youtube.com/watch?v=${v.key}`, target: '_blank', rel: 'noopener' },
                    el('img', { src: `https://i.ytimg.com/vi/${v.key}/hqdefault.jpg`, loading: 'lazy' }),
                    el('div', { class: 'play', text: '▶' }),
                    el('div', { class: 'cap', text: `${v.type}: ${v.name}` })));
            });
            body.appendChild(s);
            addMain(b);
        }

        function renderGallery(m) {
            const imgs = (m.images && m.images.backdrops) || [];
            if (!imgs.length) return;
            const { box: b, body } = box(`🖼 Backdrops <span class="tmdb-muted">· ${imgs.length}</span>`);
            const s = el('div', { class: 'tmdb-scroller tmdb-gal' });
            imgs.slice(0, 20).forEach(i => {
                const img = el('img', { src: `${IMG}w300${i.file_path}`, loading: 'lazy',
                    onclick: () => openLB(`${IMG}original${i.file_path}`) });
                s.appendChild(img);
            });
            body.appendChild(s);
            addMain(b);
        }

        function renderProviders(m) {
            const wp = (m['watch/providers'] && m['watch/providers'].results) || {};
            const r = wp[REGION] || wp.US;
            if (!r) return;
            const { box: b, body } = box(`▶ Where to Watch <span class="tmdb-muted">· ${REGION in wp ? REGION : 'US'}</span>`,
                { right: 'JustWatch', collapsible: true, collapsed: true, key: 'providers' });
            const wrap = el('div', { class: 'tmdb-prov' });
            const groups = [['Stream', r.flatrate], ['Rent', r.rent], ['Buy', r.buy], ['Free', r.free], ['Ads', r.ads]];
            let any = false;
            groups.forEach(([label, arr]) => {
                if (!arr || !arr.length) return; any = true;
                wrap.appendChild(el('div', { class: 'grp', text: label }));
                arr.forEach(p => wrap.appendChild(el('img', {
                    src: `${IMG}w45${p.logo_path}`, title: p.provider_name, alt: p.provider_name, loading: 'lazy'
                })));
            });
            if (!any) return;
            body.appendChild(wrap);
            if (r.link) body.appendChild(el('div', { style: 'margin-top:8px' },
                el('a', { class: 'tmdb-chip', href: r.link, target: '_blank', rel: 'noopener', text: 'Open on JustWatch →' })));
            addSidebar(b);
        }

        function renderKeywords(m) {
            const kws = (m.keywords && (m.keywords.keywords || m.keywords.results)) || [];
            if (!kws.length) return;
            const { box: b, body } = box('🏷 Keywords', { collapsible: true, collapsed: true, key: 'keywords' });
            kws.slice(0, 40).forEach(k =>
                body.appendChild(el('a', { class: 'tmdb-chip', href: `https://www.themoviedb.org/keyword/${k.id}`, target: '_blank', rel: 'noopener', text: k.name })));
            addSidebar(b);
        }

        function renderCompanies(m) {
            const cos = m.production_companies || [];
            if (!cos.length) return;
            const { box: b, body } = box('🏢 Production', { collapsible: true, collapsed: true, key: 'production' });
            cos.forEach(c => {
                const row = el('div', { style: 'display:flex;align-items:center;gap:8px;margin:4px 0' });
                if (c.logo_path) row.appendChild(el('img', { src: `${IMG}w92${c.logo_path}`, style: 'max-width:60px;max-height:28px;background:#fff;border-radius:4px;padding:2px', loading: 'lazy' }));
                row.appendChild(el('span', { style: 'font-size:12px;color:#cfe8f5', text: c.name + (c.origin_country ? ` (${c.origin_country})` : '') }));
                body.appendChild(row);
            });
            if (m.production_countries && m.production_countries.length)
                body.appendChild(el('div', { class: 'tmdb-muted', style: 'font-size:12px;margin-top:6px', text: 'Countries: ' + m.production_countries.map(c => c.name).join(', ') }));
            if (m.spoken_languages && m.spoken_languages.length)
                body.appendChild(el('div', { class: 'tmdb-muted', style: 'font-size:12px', text: 'Languages: ' + m.spoken_languages.map(l => l.english_name || l.name).join(', ') }));
            addSidebar(b);
        }

        function renderSimilar(m) {
            const rec = ((m.recommendations && m.recommendations.results) || []);
            const sim = ((m.similar && m.similar.results) || []);
            const list = (rec.length ? rec : sim);
            if (!list.length) return;
            const { box: b, body } = box(rec.length ? '👍 Recommended' : '🎞 Similar Films');
            const s = el('div', { class: 'tmdb-scroller' });
            list.slice(0, 20).forEach(f => {
                const img = f.poster_path ? `${IMG}w185${f.poster_path}` : placeholder(f.title);
                s.appendChild(el('a', { class: 'tmdb-card', href: ptpSearch(f.title, yearOf(f.release_date)), target: '_blank', rel: 'noopener' },
                    el('img', { src: img, loading: 'lazy', alt: f.title }),
                    el('div', { class: 'nm', text: f.title }),
                    el('div', { class: 'sub', text: `${yearOf(f.release_date)}${f.vote_average ? ' · ★ ' + f.vote_average.toFixed(1) : ''}` })));
            });
            body.appendChild(s);
            addMain(b);
        }

        function renderReviews(m) {
            const rv = ((m.reviews && m.reviews.results) || []);
            if (!rv.length) return;
            const { box: b, body } = box(`✍ Reviews <span class="tmdb-muted">· ${(m.reviews.total_results || rv.length)}</span>`);
            rv.slice(0, 3).forEach(r => {
                const rating = r.author_details && r.author_details.rating;
                const head = el('div', { style: 'font-size:12px;color:#01b4e4;font-weight:700;margin-bottom:3px',
                    text: `${r.author}${rating ? '  ★ ' + rating + '/10' : ''}` });
                let txt = r.content || '';
                if (txt.length > 500) txt = txt.slice(0, 500) + '…';
                const body2 = el('div', { style: 'font-size:12px;line-height:1.5;color:#cfd8e0' }, txt);
                const card = el('div', { style: 'padding:8px 0;border-bottom:1px solid rgba(255,255,255,.07)' }, head, body2,
                    el('a', { class: 'tmdb-chip', style: 'margin-top:6px', href: r.url, target: '_blank', rel: 'noopener', text: 'read full →' }));
                body.appendChild(card);
            });
            addMain(b);
        }

        function renderLinks(m) {
            const ex = m.external_ids || {};
            const { box: b, body } = box('🔗 External Links', { collapsible: true, collapsed: true, key: 'links' });
            const links = el('div', { class: 'tmdb-links' });
            const add = (label, url) => { if (url) links.appendChild(el('a', { class: 'tmdb-chip', href: url, target: '_blank', rel: 'noopener', text: label })); };
            add('TMDB', `https://www.themoviedb.org/movie/${m.id}`);
            add('IMDb', ex.imdb_id ? `https://www.imdb.com/title/${ex.imdb_id}/` : null);
            add('Homepage', m.homepage || null);
            add('Facebook', ex.facebook_id ? `https://facebook.com/${ex.facebook_id}` : null);
            add('Instagram', ex.instagram_id ? `https://instagram.com/${ex.instagram_id}` : null);
            add('X / Twitter', ex.twitter_id ? `https://x.com/${ex.twitter_id}` : null);
            add('Wikidata', ex.wikidata_id ? `https://www.wikidata.org/wiki/${ex.wikidata_id}` : null);
            add('Letterboxd', m.title ? `https://letterboxd.com/search/${encodeURIComponent(m.title)}/` : null);
            add('Trakt', ex.imdb_id ? `https://trakt.tv/search/imdb/${ex.imdb_id}` : null);
            body.appendChild(links);
            addSidebar(b);
        }

        // Move PTP's native "Ratings" panel (IMDb / Metacritic / popcorn) into the hero top-right, hide the original
        function relocateRatings() {
            const host = document.getElementById('tmdb-hero-ratings');
            if (!host) return;
            let box = null;
            const cands = document.querySelectorAll('.box, .panel, .main_column > div, #content .thin > div');
            for (const c of cands) {
                const head = c.querySelector('.head, .box_head, .panel__heading, h2, h3, .panel-heading');
                if (head && /^ratings\b/i.test((head.textContent || '').trim())) { box = c; break; }
            }
            if (!box) { host.remove(); return; }
            const body = box.querySelector('.body, .panel__body, .panel-body') ||
                (box.querySelector('.head, .box_head, .panel__heading, h2, h3') || {}).nextElementSibling;
            if (body) host.appendChild(body);            // relocate the node itself
            box.style.display = 'none';                   // hide the now-empty original panel
            // Strip solid panel backgrounds/borders but keep icon background-images (IMDb, Metacritic, popcorn)
            [host, ...host.querySelectorAll('*')].forEach(n => {
                const cs = getComputedStyle(n);
                if (cs.backgroundImage === 'none') n.style.setProperty('background', 'transparent', 'important');
                n.style.setProperty('border', '0', 'important');
                n.style.setProperty('box-shadow', 'none', 'important');
            });
            if (!host.childNodes.length) host.remove();
        }

        // Hide PTP's native "Title [Year] by Director" heading (the hero replaces it)
        function hideNativeTitle() {
            const heads = document.querySelectorAll('.main_column h1, .main_column h2, .main_column h3, #content h2');
            for (const h of heads) {
                const t = (h.textContent || '').trim();
                if (/\[\d{4}\]\s+by\s+/i.test(t)) { h.style.display = 'none'; break; }
            }
        }

        /* ------------------------------------------------------------------ *
         *  STATUS BANNER                                                      *
         * ------------------------------------------------------------------ */
        function banner(text, isErr) {
            const bnr = el('div', {
                id: 'tmdb-banner',
                style: `margin:0 0 12px;padding:8px 12px;border-radius:6px;font-size:13px;` +
                    (isErr ? 'background:#3a1420;border:1px solid #7a2440;color:#ffb3c4'
                           : 'background:#0d2230;border:1px solid #16455f;color:#9fdcf1')
            }, text);
            const old = document.getElementById('tmdb-banner');
            if (old) old.replaceWith(bnr); else addMain(bnr, true);
            return bnr;
        }

        /* ================================================================== *
         *  HOMEPAGE MODULE (index.php)                                        *
         * ================================================================== */
        GM_addStyle(`
        .tmdb-home-scroller{display:flex;gap:12px;overflow-x:auto;padding:4px 2px 10px;scrollbar-width:thin}
        .tmdb-home-scroller::-webkit-scrollbar{height:8px}
        .tmdb-home-scroller::-webkit-scrollbar-thumb{background:#2a3948;border-radius:8px}
        .tmdb-poster{flex:0 0 auto;width:110px;text-decoration:none;color:#dfe7ee;position:relative}
        .tmdb-poster img{width:110px;height:165px;object-fit:cover;border-radius:6px;background:#182430;display:block;box-shadow:0 1px 6px rgba(0,0,0,.5)}
        .tmdb-poster .yr{position:absolute;top:6px;left:6px;background:rgba(1,180,228,.92);color:#04121a;font-weight:800;font-size:11px;padding:1px 6px;border-radius:10px}
        .tmdb-poster .ttl{font-size:11px;margin-top:5px;line-height:1.25;max-height:2.5em;overflow:hidden}
        .tmdb-poster:hover img{outline:2px solid #01b4e4}
        .tmdb-cs{list-style:none;margin:0;padding:0}
        .tmdb-cs li{padding:6px 2px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;justify-content:space-between;gap:8px;align-items:baseline}
        .tmdb-cs li:last-child{border-bottom:0}
        .tmdb-cs a{color:#cfe8f5;text-decoration:none;font-size:13px;font-weight:600}
        .tmdb-cs a:hover{color:#01b4e4;text-decoration:underline}
        .tmdb-cs .d{font-size:11px;color:#8b95a1;white-space:nowrap;flex:0 0 auto}
        #tmdb-modal{position:fixed;z-index:100000;width:340px;max-width:90vw;background:#0d151d;border:1px solid #1f3546;
            border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.7);display:none;overflow:hidden;pointer-events:none}
        #tmdb-modal.on{display:block}
        #tmdb-modal .mh{display:flex;gap:12px;padding:12px}
        #tmdb-modal .mh img{width:92px;height:138px;object-fit:cover;border-radius:6px;flex:0 0 auto;background:#182430}
        #tmdb-modal .mt{font-size:15px;font-weight:800;color:#fff;line-height:1.2;margin-bottom:3px}
        #tmdb-modal .mtag{font-style:italic;color:#9fb3c2;font-size:12px;margin-bottom:5px}
        #tmdb-modal .mmeta{font-size:12px;color:#c7d3dd;margin-bottom:5px}
        #tmdb-modal .mscore{color:#21d07a;font-weight:700}
        #tmdb-modal .mgenres{margin-bottom:2px}
        #tmdb-modal .mov{padding:0 12px 12px;font-size:12px;line-height:1.5;color:#dfe7ee;max-height:8em;overflow:hidden}
        `);

        // localStorage cache helpers (persist across reloads so TMDB is hit at most ~once/day)
        function cacheGet(k) { try { const o = JSON.parse(localStorage.getItem(k)); if (o && (Date.now() - o.t) < o.ttl) return o.v; } catch (e) {} return null; }
        function cacheSet(k, v, ttl) { try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), ttl, v })); } catch (e) {} }
        const pad2 = n => String(n).padStart(2, '0');
        const escapeHtml = s => (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

        function ensureKey() {
            if (TMDB_KEY) return true;
            const k = prompt('PTP TMDB Enricher — enter your free TMDB API key (v3) or v4 token.\nGet one at themoviedb.org/settings/api :', '');
            if (!k) return false;
            TMDB_KEY = k.trim(); GM_setValue('tmdb_key', TMDB_KEY); return true;
        }

        // PTP click-time search link — behaves like a normal user search (single match auto-redirects to the film page)
        function ptpSearch(title, year) {
            const p = new URLSearchParams({ action: 'advanced', order_by: 'relevance', searchstr: title });
            if (year) p.set('year', String(year));
            return 'https://passthepopcorn.me/torrents.php?' + p.toString();
        }

        function ptpArtistSearch(name) {
            const p = new URLSearchParams({ artistname: name || '' });
            return 'https://passthepopcorn.me/artist.php?' + p.toString();
        }

        // Genre id -> name map (cached 30 days)
        let GENRES = {};
        async function loadGenres() {
            const cached = cacheGet('tmdb_genres_' + LANG);
            if (cached) { GENRES = cached; return; }
            try {
                const j = await tmdb('/genre/movie/list');
                (j.genres || []).forEach(g => GENRES[g.id] = g.name);
                cacheSet('tmdb_genres_' + LANG, GENRES, 30 * 24 * 3600e3);
            } catch (e) {}
        }

        // Shared hover modal
        const modal = el('div', { id: 'tmdb-modal' });
        document.body.appendChild(modal);
        let modalHideT = null;
        function showModal(anchor, mv) {
            clearTimeout(modalHideT);
            const poster = mv.poster_path ? IMG + 'w185' + mv.poster_path : placeholder(mv.title || mv.name);
            const year = yearOf(mv.release_date);
            const score = mv.vote_average
                ? `<span class="mscore">★ ${mv.vote_average.toFixed(1)}</span> <span style="color:#8b95a1">(${(mv.vote_count || 0).toLocaleString()} votes)</span>`
                : '<span style="color:#8b95a1">Not yet rated</span>';
            const genres = (mv.genre_ids || []).map(id => GENRES[id]).filter(Boolean).map(g => `<span class="tmdb-chip">${g}</span>`).join('');
            const dateLine = (mv.digital ? '🛎 Digital ' + mv.digital : (mv.release_date ? '📅 ' + mv.release_date : ''))
                + (mv.original_language ? '  ·  ' + mv.original_language.toUpperCase() : '');
            modal.innerHTML =
                `<div class="mh"><img src="${poster}" loading="lazy">
                   <div><div class="mt">${escapeHtml(mv.title || mv.name)}${year ? ' (' + year + ')' : ''}</div>
                   ${mv.original_title && mv.original_title !== mv.title ? `<div class="mtag">${escapeHtml(mv.original_title)}</div>` : ''}
                   <div class="mmeta">${score}</div>
                   <div class="mmeta">${dateLine}</div>
                   <div class="mgenres">${genres}</div></div></div>
                 ${mv.overview ? `<div class="mov">${escapeHtml(mv.overview)}</div>` : ''}`;
            modal.classList.add('on');
            positionModal(anchor);
        }
        function positionModal(anchor) {
            const r = anchor.getBoundingClientRect();
            const mw = modal.offsetWidth || 340, mh = modal.offsetHeight || 220;
            let left = r.right + 10, top = r.top;
            if (left + mw > window.innerWidth - 8) left = r.left - mw - 10;
            if (left < 8) left = Math.min(Math.max(r.left, 8), window.innerWidth - mw - 8);
            if (top + mh > window.innerHeight - 8) top = window.innerHeight - mh - 8;
            if (top < 8) top = 8;
            modal.style.left = left + 'px'; modal.style.top = top + 'px';
        }
        function hideModal() { modalHideT = setTimeout(() => modal.classList.remove('on'), 60); }
        function attachModal(node, mv) {
            node.addEventListener('mouseenter', () => showModal(node, mv));
            node.addEventListener('mouseleave', hideModal);
        }

        const slim = m => ({
            id: m.id, title: m.title, original_title: m.original_title, release_date: m.release_date,
            poster_path: m.poster_path, vote_average: m.vote_average, vote_count: m.vote_count,
            overview: m.overview, genre_ids: m.genre_ids, original_language: m.original_language, popularity: m.popularity
        });

        GM_addStyle(`
        /* Uploads carousel */
        .tmdb-carousel{position:relative}
        .tmdb-car-track{display:flex;gap:10px;overflow-x:auto;scroll-behavior:smooth;scroll-snap-type:x mandatory;padding:2px 2px 8px}
        .tmdb-car-track::-webkit-scrollbar{height:6px}
        .tmdb-car-track::-webkit-scrollbar-thumb{background:#2a3948;border-radius:8px}
        .tmdb-car-track .tmdb-poster{scroll-snap-align:start;width:92px}
        .tmdb-car-track .tmdb-poster img{width:92px;height:138px}
        .tmdb-car-btn{position:absolute;top:60px;z-index:3;width:26px;height:26px;border-radius:50%;border:0;cursor:pointer;
            background:rgba(1,180,228,.92);color:#04121a;font-weight:800;line-height:1;font-size:16px}
        .tmdb-car-btn:hover{background:#01b4e4}
        .tmdb-car-prev{left:-4px}
        .tmdb-car-next{right:-4px}
        /* Native-panel toggles, styled like PTP's linkbox bracket links */
        .tmdb-linktoggle{cursor:pointer;text-decoration:none;font-weight:600;margin-right:6px}
        .tmdb-linktoggle:hover{text-decoration:underline}
        .tmdb-togglebar{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 14px}
        `);

        /* ---- New Uploads carousel (homepage) ---- */
        function collectUploads() {
            const box = document.getElementById('last5t');
            if (!box) return [];
            const seen = new Set(), out = [];
            box.querySelectorAll('a.l_movie').forEach(a => {
                const m = (a.getAttribute('href') || '').match(/id=(\d+)/);
                if (!m) return;
                const id = m[1];
                if (seen.has(id)) return; seen.add(id);
                out.push({ id, title: a.textContent.replace(/\s+/g, ' ').trim(), href: a.href });
            });
            return out.slice(0, 15);
        }
        async function resolveCover(u) {
            const key = 'tmdb_cover_' + u.id;
            const cached = cacheGet(key);
            if (cached) return cached;
            let data = {};
            try {
                const q = u.title.replace(/\s*[\[(]\d{4}[\])]\s*$/, '').trim();
                const yr = (u.title.match(/[\[(](\d{4})[\])]/) || [])[1];
                const r = await tmdb('/search/movie', yr ? { query: q, year: yr } : { query: q });
                const hit = (r.results || [])[0];
                if (hit) data = slim(hit);
            } catch (e) {}
            cacheSet(key, data, 30 * 24 * 3600e3);
            return data;
        }
        async function renderUploads(list, sidebar) {
            if (!sidebar || !list.length) return;
            const covers = await Promise.all(list.map(resolveCover));
            const { box: b, body } = box('⬆ New Uploads');
            const wrap = el('div', { class: 'tmdb-carousel' });
            const track = el('div', { class: 'tmdb-car-track' });
            list.forEach((u, i) => {
                const mv = covers[i] || {};
                const poster = mv.poster_path ? IMG + 'w185' + mv.poster_path : placeholder(u.title);
                const a = el('a', { class: 'tmdb-poster', href: u.href, title: u.title },
                    el('img', { src: poster, loading: 'lazy', alt: u.title }),
                    el('div', { class: 'ttl', text: u.title }));
                attachModal(a, Object.assign({ title: u.title }, mv));
                track.appendChild(a);
            });
            wrap.appendChild(el('button', { class: 'tmdb-car-btn tmdb-car-prev', text: '‹', onclick: () => track.scrollBy({ left: -200, behavior: 'smooth' }) }));
            wrap.appendChild(track);
            wrap.appendChild(el('button', { class: 'tmdb-car-btn tmdb-car-next', text: '›', onclick: () => track.scrollBy({ left: 200, behavior: 'smooth' }) }));
            body.appendChild(wrap);
            const native = document.getElementById('last5t');
            if (native) native.style.display = 'none';       // replace the native uploads box
            sidebar.insertBefore(b, sidebar.firstChild);      // very top of the right panel
        }

        /* ---- Movie page: toggle native Cast / Comments panels ---- */
        function setupNativeToggles() {
            const castTable = ([...document.querySelectorAll('th')].find(t => /^actor$/i.test(t.textContent.trim())) || {}).closest?.('table');
            const comments = document.getElementById('comments-tab') || document.getElementById('comments-container');
            const targets = [
                { el: castTable, label: 'PTP Cast', key: 'ptp_show_cast' },
                { el: comments, label: 'Comments', key: 'ptp_show_comments' },
            ].filter(t => t.el);
            if (!targets.length) return;

            const nodes = [];
            targets.forEach(t => {
                let show = GM_getValue(t.key, false);         // default hidden
                const a = el('a', { class: 'tmdb-linktoggle' });
                const apply = () => {
                    t.el.style.display = show ? '' : 'none';
                    a.style.color = show ? '#57c85a' : '#e0524f';   // green = shown, red = hidden
                    a.textContent = `[${t.label}]`;
                    a.title = `Click to ${show ? 'hide' : 'show'} the ${t.label} panel (currently ${show ? 'shown' : 'hidden'})`;
                };
                a.addEventListener('click', (e) => { e.preventDefault(); show = !show; GM_setValue(t.key, show); apply(); });
                apply();
                nodes.push(a);
            });

            // Prefer PTP's native linkbox: insert at the very start (left) of the bar
            const linkbox = document.querySelector('.linkbox');
            if (linkbox) {
                const frag = document.createDocumentFragment();
                nodes.forEach(n => { frag.appendChild(n); frag.appendChild(document.createTextNode(' ')); });
                linkbox.insertBefore(frag, linkbox.firstChild);
            } else {
                const bar = el('div', { class: 'tmdb-togglebar' }, ...nodes);
                const hero = document.querySelector('.tmdb-hero');
                if (hero && hero.parentNode) hero.parentNode.insertBefore(bar, hero.nextSibling);
                else addMain(bar, true);
            }
        }

        /* ---- On This Day ---- */
        const OTD_YEARS = 30;
        async function buildOnThisDay() {
            const now = new Date();
            const mm = pad2(now.getMonth() + 1), dd = pad2(now.getDate());
            const key = `tmdb_otd_${mm}${dd}_${LANG}`;
            const cached = cacheGet(key);
            if (cached) return cached;
            const y0 = now.getFullYear() - 1;
            const years = Array.from({ length: OTD_YEARS }, (_, i) => y0 - i);
            const results = await Promise.all(years.map(y =>
                tmdb('/discover/movie', {
                    'primary_release_date.gte': `${y}-${mm}-${dd}`,
                    'primary_release_date.lte': `${y}-${mm}-${dd}`,
                    'sort_by': 'popularity.desc', 'vote_count.gte': '40', 'include_adult': 'false'
                }).then(r => (r.results || [])[0]).catch(() => null)
            ));
            const list = results.filter(Boolean).map(slim).sort((a, b) => b.popularity - a.popularity);
            cacheSet(key, list, 20 * 3600e3);
            return list;
        }
        function renderOnThisDay(list, host) {
            if (!list.length || !host) return;
            const now = new Date();
            const { box: b, body } = box(`📅 On This Day <span class="tmdb-muted">· ${now.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</span>`);
            const s = el('div', { class: 'tmdb-home-scroller' });
            list.forEach(mv => {
                const poster = mv.poster_path ? IMG + 'w185' + mv.poster_path : placeholder(mv.title);
                const a = el('a', { class: 'tmdb-poster', href: ptpSearch(mv.title, yearOf(mv.release_date)), target: '_blank', rel: 'noopener' },
                    el('img', { src: poster, loading: 'lazy', alt: mv.title }),
                    el('span', { class: 'yr', text: yearOf(mv.release_date) }),
                    el('div', { class: 'ttl', text: mv.title }));
                attachModal(a, mv);
                s.appendChild(a);
            });
            body.appendChild(s);
            body.appendChild(el('div', { class: 'tmdb-muted', style: 'font-size:11px', text: 'Click a poster to search PTP · hover for details' }));
            host.insertBefore(b, host.firstChild);
        }

        /* ---- Coming Soon: Digital ---- */
        const CS_DAYS = 120;
        const fmtDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
        const fmtShort = iso => { try { return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return iso; } };
        async function buildComingSoonDigital() {
            const key = `tmdb_csd_${REGION}_${LANG}`;
            const cached = cacheGet(key);
            if (cached) return cached;
            const today = new Date();
            const end = new Date(today.getTime() + CS_DAYS * 86400e3);
            const disc = await tmdb('/discover/movie', {
                'with_release_type': '4|5', 'region': REGION,
                'release_date.gte': fmtDate(today), 'release_date.lte': fmtDate(end),
                'sort_by': 'popularity.desc', 'include_adult': 'false'
            }).catch(() => ({ results: [] }));
            const cand = (disc.results || []).slice(0, 25);
            const detailed = await Promise.all(cand.map(m =>
                tmdb(`/movie/${m.id}/release_dates`).then(rd => {
                    const reg = (rd.results || []).find(x => x.iso_3166_1 === REGION);
                    let digi = null;
                    if (reg) { const d = reg.release_dates.find(x => x.type === 4) || reg.release_dates.find(x => x.type === 5); if (d) digi = d.release_date.slice(0, 10); }
                    return digi ? Object.assign(slim(m), { digital: digi }) : null;
                }).catch(() => null)
            ));
            const nowStr = fmtDate(today), endStr = fmtDate(end);
            const list = detailed.filter(Boolean)
                .filter(m => m.digital >= nowStr && m.digital <= endStr)
                .sort((a, b) => a.digital.localeCompare(b.digital))
                .slice(0, 12);
            cacheSet(key, list, 20 * 3600e3);
            return list;
        }
        function renderComingSoonDigital(list, sidebar) {
            if (!list.length || !sidebar) return;
            const { box: b, body } = box(`🛎 Coming Soon: Digital <span class="tmdb-muted">· ${REGION}</span>`);
            const ul = el('ul', { class: 'tmdb-cs' });
            list.forEach(mv => {
                const li = el('li', {},
                    el('a', { href: `https://www.themoviedb.org/movie/${mv.id}`, target: '_blank', rel: 'noopener',
                        text: `${mv.title}${yearOf(mv.release_date) ? ' (' + yearOf(mv.release_date) + ')' : ''}` }),
                    el('span', { class: 'd', text: fmtShort(mv.digital) }));
                attachModal(li, mv);
                ul.appendChild(li);
            });
            body.appendChild(ul);
            // place directly below the first (top) sidebar panel
            const firstPanel = sidebar.querySelector('.panel');
            if (firstPanel && firstPanel.nextSibling) sidebar.insertBefore(b, firstPanel.nextSibling);
            else if (firstPanel) sidebar.appendChild(b);
            else sidebar.insertBefore(b, sidebar.firstChild);
        }

        async function runHome() {
            if (!ensureKey()) return;
            await loadGenres();
            const sidebar = document.querySelector('.sidebar');
            const main = document.querySelector('.main-column') || document.querySelector('.main_column');
            // Hide PTP's native "Latest Torrents" uploads box entirely (no carousel)
            const nativeUploads = document.getElementById('last5t');
            if (nativeUploads) nativeUploads.style.display = 'none';
            try {
                const [otd, csd] = await Promise.all([buildOnThisDay(), buildComingSoonDigital()]);
                renderOnThisDay(otd, main);
                renderComingSoonDigital(csd, sidebar);
                LOG('home enriched', { onThisDay: otd.length, comingSoon: csd.length });
            } catch (e) { LOG('home error', e); }
        }

        /* ------------------------------------------------------------------ *
         *  MAIN                                                               *
         * ------------------------------------------------------------------ */
        async function runMovie() {
            if (!ensureKey()) { banner('PTP TMDB Enricher: no API key set. Open the Tampermonkey menu → "Set TMDB API key" to enable.', true); return; }

            const imdb = getImdbId();
            if (!imdb) { banner('PTP TMDB Enricher: could not find an IMDb id on this page.', true); return; }

            const bnr = banner(`PTP TMDB Enricher: looking up ${imdb} …`);
            try {
                const found = await tmdb(`/find/${imdb}`, { external_source: 'imdb_id' });
                const hit = (found.movie_results && found.movie_results[0]);
                if (!hit) { bnr.textContent = `PTP TMDB Enricher: ${imdb} not found on TMDB (may be a TV title or unmatched).`; return; }

                const m = await tmdb(`/movie/${hit.id}`, {
                    append_to_response: 'credits,videos,images,keywords,recommendations,similar,watch/providers,external_ids,release_dates,reviews',
                    include_image_language: `${LANG.split('-')[0]},en,null`
                });

                // Render everything (each guards itself)
                renderHero(m);
                relocateRatings();
                hideNativeTitle();
                setupNativeToggles();
                renderProviders(m);
                renderLinks(m);
                renderCompanies(m);
                renderKeywords(m);
                renderCast(m);
                renderTrailers(m);
                renderSimilar(m);
                renderGallery(m);
                renderReviews(m);

                bnr.remove();
                LOG('enriched', m.title, m.id);
            } catch (e) {
                bnr.classList.add('err');
                banner('PTP TMDB Enricher error: ' + e.message + (String(e.message).match(/api key|401|invalid/i) ? ' — check your key via the Tampermonkey menu.' : ''), true);
                LOG('error', e);
            }
        }

        // Dispatch by page type
        function run() {
            const path = location.pathname;
            const onMovie = /torrents\.php/.test(path) && /[?&]id=\d+/.test(location.search);
            const onHome = /\/index\.php$/.test(path) || path === '/';
            if (onMovie) runMovie();
            else if (onHome) runHome();
        }

        run();
    })();
    }

    /* ================================================================== *
     *  PTP TMDB People v1.0.0  --  artist.php                             *
     * ================================================================== */
    function MOD_tmdbPeople() {
    (function () {
        'use strict';

        const IMG = 'https://image.tmdb.org/t/p/';
        const API = 'https://api.themoviedb.org/3';
        const KEY_CACHE = 'ptp_tmdb_people_cache_v1';
        const CACHE_TTL = 24 * 3600e3;
        const DETAIL_TTL = 14 * 24 * 3600e3;

        const getKey = () => PTPSuite.tmdbKey();
        const getLang = () => PTPSuite.tmdbLang();
        const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const yearOf = d => (d && /^\d{4}/.test(d)) ? d.slice(0, 4) : '';
        const shortDate = iso => {
            if (!iso) return '';
            try { return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
            catch (e) { return iso; }
        };

        function el(tag, attrs = {}, ...kids) {
            const node = document.createElement(tag);
            for (const [k, v] of Object.entries(attrs)) {
                if (k === 'class') node.className = v;
                else if (k === 'html') node.innerHTML = v;
                else if (k === 'text') node.textContent = v;
                else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
                else if (v !== null && v !== undefined) node.setAttribute(k, v);
            }
            kids.flat().forEach(kid => {
                if (kid === null || kid === undefined) return;
                node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
            });
            return node;
        }

        function gmJSON(key, fallback) {
            try {
                const raw = GM_getValue(key, null);
                if (raw === null || raw === undefined || raw === '') return fallback;
                return typeof raw === 'string' ? JSON.parse(raw) : raw;
            } catch (e) { return fallback; }
        }

        function setJSON(key, value) {
            GM_setValue(key, JSON.stringify(value));
        }

        function cacheGet(key, ttl) {
            const bag = gmJSON(KEY_CACHE, {});
            const item = bag[key];
            if (!item || !item.ts || Date.now() - item.ts > ttl) return null;
            return item.value;
        }

        function cacheSet(key, value) {
            const bag = gmJSON(KEY_CACHE, {});
            bag[key] = { ts: Date.now(), value };
            const keys = Object.keys(bag).sort((a, b) => bag[b].ts - bag[a].ts);
            keys.slice(50).forEach(k => delete bag[k]);
            setJSON(KEY_CACHE, bag);
        }

        function tmdb(path, params = {}) {
            const key = getKey();
            const usp = new URLSearchParams(params);
            usp.set('language', getLang());
            const isV4 = key.startsWith('eyJ');
            if (!isV4) usp.set('api_key', key);
            const headers = { 'Content-Type': 'application/json;charset=utf-8' };
            if (isV4) headers.Authorization = `Bearer ${key}`;
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: `${API}${path}?${usp.toString()}`,
                    headers,
                    timeout: 22000,
                    onload: r => {
                        try {
                            const json = JSON.parse(r.responseText || '{}');
                            if (r.status >= 200 && r.status < 300) resolve(json);
                            else reject(new Error(json.status_message || `TMDB HTTP ${r.status}`));
                        } catch (e) { reject(e); }
                    },
                    onerror: () => reject(new Error('TMDB network error')),
                    ontimeout: () => reject(new Error('TMDB request timed out')),
                });
            });
        }

        function artistName() {
            const img = document.querySelector('.sidebar img[alt], img[alt]');
            const headings = [...document.querySelectorAll('h1,h2')].map(h => (h.textContent || '').replace(/\s+/g, ' ').trim());
            const fromHeading = headings.find(t => t && !/^(all movies|search|artist info|statistics|tags)$/i.test(t));
            if (fromHeading) return fromHeading;
            if (img && img.alt) return img.alt.trim();
            return (document.title || '').split(' :: ')[0].replace(/\s+/g, ' ').trim();
        }

        function imdbPersonId() {
            const link = document.querySelector('a[href*="imdb.com/name/nm"]');
            if (link) {
                const m = link.href.match(/nm\d{6,}/);
                if (m) return m[0];
            }
            const text = document.body.innerText || '';
            const m = text.match(/IMDb:\s*(?:nm)?(\d{5,9})/i);
            return m ? 'nm' + m[1].padStart(7, '0') : '';
        }

        function ptpSearch(title, year) {
            const p = new URLSearchParams({ action: 'advanced', order_by: 'relevance', searchstr: title || '' });
            if (year) p.set('year', String(year));
            return '/torrents.php?' + p.toString();
        }

        function personUrl(person, size = 'h632') {
            return person && person.profile_path ? `${IMG}${size}${person.profile_path}` : '';
        }

        function posterUrl(item, size = 'w342') {
            return item && item.poster_path ? `${IMG}${size}${item.poster_path}` : '';
        }

        function backdropUrl(item, size = 'w1280') {
            return item && item.backdrop_path ? `${IMG}${size}${item.backdrop_path}` : '';
        }

        function placeholder(text) {
            const label = esc(text || 'No Image');
            return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
                `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 342 513"><rect width="342" height="513" fill="#111822"/><text x="171" y="248" text-anchor="middle" fill="#718096" font-family="Arial" font-size="22" font-weight="700">${label}</text></svg>`
            );
        }

        function ageLine(person) {
            if (!person.birthday) return '';
            const born = shortDate(person.birthday);
            if (person.deathday) return `${born} - ${shortDate(person.deathday)}`;
            const today = new Date();
            const birth = new Date(person.birthday + 'T00:00:00');
            let age = today.getFullYear() - birth.getFullYear();
            const beforeBirthday = today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
            if (beforeBirthday) age -= 1;
            return `${born}${age > 0 ? ` (${age})` : ''}`;
        }

        function mergeCredits(person) {
            const cast = (((person.combined_credits || {}).cast) || [])
                .filter(c => c.media_type === 'movie' && c.id)
                .map(c => Object.assign({}, c, { ptp_role: c.character || 'Actor' }));
            const crew = (((person.combined_credits || {}).crew) || [])
                .filter(c => c.media_type === 'movie' && c.id)
                .map(c => Object.assign({}, c, { ptp_role: c.job || c.department || 'Crew' }));
            const map = new Map();
            [...cast, ...crew].forEach(c => {
                const prev = map.get(c.id);
                if (!prev) map.set(c.id, c);
                else {
                    const roles = new Set([prev.ptp_role, c.ptp_role].filter(Boolean));
                    prev.ptp_role = Array.from(roles).slice(0, 3).join(' / ');
                    prev.popularity = Math.max(prev.popularity || 0, c.popularity || 0);
                    if (!prev.poster_path && c.poster_path) prev.poster_path = c.poster_path;
                    if (!prev.backdrop_path && c.backdrop_path) prev.backdrop_path = c.backdrop_path;
                }
            });
            return Array.from(map.values())
                .filter(c => c.title && (c.poster_path || c.backdrop_path))
                .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        }

        function ptpStats() {
            const text = document.body.innerText || '';
            const pick = label => {
                const m = text.match(new RegExp(label + ':\\s*([\\d,]+)', 'i'));
                return m ? m[1] : '';
            };
            return [
                ['PTP movies', pick('Number of movies')],
                ['Torrents', pick('Number of torrents')],
                ['Seeders', pick('Number of seeders')],
                ['Snatches', pick('Number of snatches')],
            ].filter(x => x[1]);
        }

        async function findPerson() {
            const name = artistName();
            const imdb = imdbPersonId();
            const cacheKey = `person_${imdb || name}_${getLang()}`;
            const cached = cacheGet(cacheKey, DETAIL_TTL);
            if (cached) return cached;
            let personId = null;
            if (imdb) {
                const found = await tmdb(`/find/${imdb}`, { external_source: 'imdb_id' });
                const hit = (found.person_results || [])[0];
                if (hit) personId = hit.id;
            }
            if (!personId && name) {
                const searched = await tmdb('/search/person', { query: name, include_adult: 'false' });
                const hit = (searched.results || [])[0];
                if (hit) personId = hit.id;
            }
            if (!personId) throw new Error('Could not match this artist on TMDB.');
            const person = await tmdb(`/person/${personId}`, {
                append_to_response: 'combined_credits,images,external_ids,tagged_images',
                include_image_language: `${getLang().split('-')[0]},en,null`,
            });
            cacheSet(cacheKey, person);
            return person;
        }

        function hideNativeName(name) {
            const heading = [...document.querySelectorAll('h1,h2')]
                .find(h => (h.textContent || '').replace(/\s+/g, ' ').trim() === name);
            if (heading) heading.classList.add('ptp-person-native-title-hidden');
        }

        function fixNativeImages(person) {
            const src = personUrl(person, 'h632');
            if (!src) return;
            document.querySelectorAll('.sidebar img, img[alt]').forEach(img => {
                const alt = (img.getAttribute('alt') || '').trim();
                if (img.closest('.sidebar') || alt === person.name) {
                    img.src = src;
                    img.alt = person.name || alt || 'Artist';
                    img.loading = 'lazy';
                }
            });
        }

        function collapseNativeSearch() {
            const form = document.querySelector('.toggleable-search-form__search-form, .search-form--toggleable, .search-form');
            const isVisible = !form || form.offsetParent !== null;
            if (!isVisible) return;
            const toggles = [
                ...document.querySelectorAll('.toggleable-search-form__toggler-container a, .toggleable-search-form__toggler-container button, .search-form__advanced-basic-toggler, a, button')
            ];
            const toggle = toggles.find(node => /^\s*\[-\]\s*Search\s*$/i.test(node.textContent || ''));
            if (toggle) toggle.click();
        }

        function hostNode() {
            return document.querySelector('.main-column') ||
                document.querySelector('.main_column') ||
                document.querySelector('#content .thin') ||
                document.querySelector('#content') ||
                document.body;
        }

        function renderLoading(host, name) {
            let page = document.getElementById('ptp-person-page');
            if (page) page.remove();
            page = el('section', { id: 'ptp-person-page', class: 'ptp-person-page' },
                el('div', { class: 'ptp-person-loading', text: `Loading TMDB profile for ${name || 'artist'}...` })
            );
            host.insertBefore(page, host.firstChild || null);
            return page;
        }

        function renderError(page, message) {
            page.innerHTML = '';
            page.appendChild(el('div', { class: 'ptp-person-error' },
                el('strong', { text: 'TMDB People' }),
                el('span', { text: message })
            ));
        }

        function statCards(person, credits) {
            const known = person.known_for_department || '';
            const jobs = new Set(credits.flatMap(c => (c.ptp_role || '').split(' / ')).filter(Boolean));
            const stats = [
                ['Known for', known],
                ['Credits', String(credits.length)],
                ['TMDB score', person.popularity ? person.popularity.toFixed(1) : ''],
                ['Roles', jobs.size ? String(jobs.size) : ''],
                ...ptpStats(),
            ].filter(x => x[1]);
            return el('div', { class: 'ptp-person-stats' },
                ...stats.slice(0, 8).map(([label, value]) => el('div', { class: 'ptp-person-stat' },
                    el('span', { text: label }),
                    el('strong', { text: value })
                ))
            );
        }

        function creditCard(c) {
            const year = yearOf(c.release_date || c.first_air_date);
            return el('a', { class: 'ptp-person-credit', href: ptpSearch(c.title || c.name, year), title: `${c.title || c.name}${year ? ' (' + year + ')' : ''}` },
                el('img', { src: posterUrl(c, 'w342') || placeholder(c.title || c.name), alt: c.title || c.name || '', loading: 'lazy' }),
                el('span', { class: 'ptp-person-credit-title', text: c.title || c.name || 'Untitled' }),
                el('span', { class: 'ptp-person-credit-meta', text: [year, c.ptp_role].filter(Boolean).join(' - ') })
            );
        }

        function renderPage(page, person) {
            const credits = mergeCredits(person);
            const knownFor = credits.slice(0, 16);
            const recent = credits.slice().sort((a, b) => String(b.release_date || '').localeCompare(String(a.release_date || ''))).slice(0, 18);
            const backdrop = backdropUrl(knownFor.find(c => c.backdrop_path), 'w1280');
            document.body.classList.add('ptp-person-active');
            hideNativeName(person.name);
            fixNativeImages(person);
            page.innerHTML = '';
            if (backdrop) page.style.setProperty('--ptp-person-backdrop', `url("${backdrop}")`);

            page.appendChild(el('section', { class: 'ptp-person-hero' },
                el('div', { class: 'ptp-person-hero-bg' }),
                el('div', { class: 'ptp-person-hero-inner' },
                    el('img', { class: 'ptp-person-profile', src: personUrl(person) || placeholder(person.name), alt: person.name || '', loading: 'lazy' }),
                    el('div', { class: 'ptp-person-copy' },
                        el('div', { class: 'ptp-person-kicker', text: person.known_for_department || 'Person' }),
                        el('h1', { text: person.name || artistName() }),
                        el('div', { class: 'ptp-person-meta', text: [ageLine(person), person.place_of_birth].filter(Boolean).join(' - ') }),
                        person.biography ? el('p', { class: 'ptp-person-bio', text: person.biography }) : null,
                        el('div', { class: 'ptp-person-actions' },
                            person.external_ids && person.external_ids.imdb_id ? el('a', { href: `https://www.imdb.com/name/${person.external_ids.imdb_id}/`, target: '_blank', rel: 'noopener', text: 'IMDb' }) : null,
                            el('a', { href: `https://www.themoviedb.org/person/${person.id}`, target: '_blank', rel: 'noopener', text: 'TMDB' })
                        )
                    )
                )
            ));

            page.appendChild(statCards(person, credits));

            if (knownFor.length) {
                page.appendChild(el('section', { class: 'ptp-person-section' },
                    el('div', { class: 'ptp-person-section-head' },
                        el('h2', { text: 'Known For' }),
                        el('span', { text: 'TMDB ranked, links search PTP' })
                    ),
                    el('div', { class: 'ptp-person-strip' }, ...knownFor.map(creditCard))
                ));
            }

            const images = (((person.images || {}).profiles) || []).slice(0, 10);
            if (images.length) {
                page.appendChild(el('section', { class: 'ptp-person-section' },
                    el('div', { class: 'ptp-person-section-head' },
                        el('h2', { text: 'Gallery' }),
                        el('span', { text: `${images.length} profile images` })
                    ),
                    el('div', { class: 'ptp-person-gallery' },
                        ...images.map(img => el('img', { src: `${IMG}h632${img.file_path}`, alt: person.name || '', loading: 'lazy' }))
                    )
                ));
            }

            if (recent.length) {
                page.appendChild(el('section', { class: 'ptp-person-section' },
                    el('div', { class: 'ptp-person-section-head' },
                        el('h2', { text: 'Recent Credits' }),
                        el('span', { text: 'Latest dated TMDB credits' })
                    ),
                    el('div', { class: 'ptp-person-credit-grid' }, ...recent.map(creditCard))
                ));
            }
            setTimeout(collapseNativeSearch, 0);
        }

        GM_addStyle(`
        body.ptp-person-active .ptp-person-native-title-hidden{display:none !important}
        .ptp-person-page{margin:0 0 28px;color:#dce6f3;font-family:Inter,"Open Sans",Arial,sans-serif}
        .ptp-person-page *{box-sizing:border-box}
        .ptp-person-loading,.ptp-person-error{padding:16px;border:1px solid rgba(120,183,255,.18);border-radius:8px;background:#101620;color:#9da9bd}
        .ptp-person-error{display:flex;gap:10px;align-items:center;border-color:rgba(255,91,79,.4);color:#ffbbb4}
        .ptp-person-hero{position:relative;overflow:hidden;border:1px solid rgba(120,183,255,.16);border-radius:10px;background:#0b111a;margin:0 0 16px}
        .ptp-person-hero-bg{position:absolute;inset:0;background:linear-gradient(90deg,rgba(7,12,18,.98),rgba(7,12,18,.9) 48%,rgba(7,12,18,.64)),var(--ptp-person-backdrop,none) center/cover no-repeat;opacity:.96}
        .ptp-person-hero-inner{position:relative;display:grid;grid-template-columns:180px minmax(0,1fr);gap:22px;padding:24px}
        .ptp-person-profile{width:180px;aspect-ratio:2/3;object-fit:cover;border-radius:8px;background:#141a23;box-shadow:0 12px 28px rgba(0,0,0,.45)}
        .ptp-person-kicker{margin:0 0 7px;color:#78b7ff;font-size:.78rem;font-weight:900;text-transform:uppercase;letter-spacing:.08em}
        .ptp-person-copy h1{margin:0 0 8px;color:#fff;font:400 2.35rem/1 Impact,"Arial Black",sans-serif;letter-spacing:.02em}
        .ptp-person-meta{color:#aab7c8;font-size:.9rem;margin-bottom:12px}
        .ptp-person-bio{max-width:92ch;max-height:12.8em;overflow:auto;margin:0 0 14px;color:#e7eef8;font-size:.94rem;line-height:1.55}
        .ptp-person-actions{display:flex;gap:8px;flex-wrap:wrap}
        .ptp-person-actions a{display:inline-flex;align-items:center;min-height:32px;padding:7px 12px;border:1px solid rgba(75,156,255,.42);border-radius:6px;background:#1b63ad;color:#fff !important;font-size:.8rem;font-weight:800;text-decoration:none}
        .ptp-person-actions a:hover{background:#2477cf;color:#fff !important}
        .ptp-person-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:0 0 18px}
        .ptp-person-stat{padding:12px;border:1px solid rgba(157,169,189,.18);border-radius:8px;background:#101620}
        .ptp-person-stat span{display:block;color:#8593a6;font-size:.72rem;font-weight:800;text-transform:uppercase}
        .ptp-person-stat strong{display:block;margin-top:4px;color:#fff;font-size:1.04rem}
        .ptp-person-section{margin:0 0 22px}
        .ptp-person-section-head{display:flex;align-items:baseline;gap:10px;margin:0 0 10px}
        .ptp-person-section-head h2{margin:0;color:#fff;font-size:1.08rem;line-height:1.2}
        .ptp-person-section-head span{color:#748095;font-size:.78rem}
        .ptp-person-strip{display:grid;grid-auto-flow:column;grid-auto-columns:128px;gap:13px;overflow-x:auto;overflow-y:hidden;padding:3px 3px 12px;scrollbar-width:thin}
        .ptp-person-strip::-webkit-scrollbar{height:8px}
        .ptp-person-strip::-webkit-scrollbar-thumb{background:#2a3948;border-radius:999px}
        .ptp-person-credit-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:14px}
        .ptp-person-credit{display:block;min-width:0;color:#dce6f3 !important;text-decoration:none !important}
        .ptp-person-credit img{display:block;width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:7px;background:#141a23;box-shadow:0 8px 20px rgba(0,0,0,.26)}
        .ptp-person-credit:hover img{outline:2px solid #4b9cff;outline-offset:2px}
        .ptp-person-credit-title{display:-webkit-box;margin-top:7px;color:#fff;font-size:.78rem;font-weight:850;line-height:1.22;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical}
        .ptp-person-credit-meta{display:block;margin-top:3px;color:#95a3b7;font-size:.7rem;line-height:1.25}
        .ptp-person-gallery{display:grid;grid-auto-flow:column;grid-auto-columns:116px;gap:10px;overflow-x:auto;padding-bottom:10px}
        .ptp-person-gallery img{width:116px;aspect-ratio:2/3;object-fit:cover;border-radius:7px;background:#141a23}
        body.ptp-person-active .search-form{margin-top:14px !important;border-color:rgba(120,183,255,.18) !important;background:#101620 !important}
        body.ptp-person-active .cover-movie-list{gap:18px !important}
        body.ptp-person-active .cover-movie-list__movie{transition:transform 150ms ease}
        body.ptp-person-active .cover-movie-list__movie:hover{transform:translateY(-3px)}
        @media (max-width: 760px){
          .ptp-person-hero-inner{grid-template-columns:1fr;padding:18px}
          .ptp-person-profile{width:min(180px,52vw)}
          .ptp-person-copy h1{font-size:1.9rem}
        }
        `);

        async function run() {
            const host = hostNode();
            const name = artistName();
            const page = renderLoading(host, name);
            if (!getKey()) {
                renderError(page, 'Set your TMDB API key from the userscript menu to enrich artist pages.');
                return;
            }
            try {
                const person = await findPerson();
                renderPage(page, person);
            } catch (e) {
                renderError(page, e.message || String(e));
            }
        }

        run();
    })();
    }

    /* ================================================================== *
     *  PTP -> IMDb Parents Guide (GraphQL only) v2.3.0  --  torrents.php
     * ================================================================== */
    function MOD_parentsGuide() {
    /*
     * NOTE ON SCHEMA
     * --------------
     * The official IMDb API docs describe the AWS Data Exchange product, whose JSON
     * shape is:  parentsGuide[] { category, severity, votes, parentsGuideItems }.
     * That shape belongs to the *paid* endpoint and does NOT match the field names
     * exposed by the internal api.graphql.imdb.com endpoint. The internal endpoint
     * speaks the same GraphQL schema the imdb.com website consumes, which is the
     * shape this query is built against (title.parentsGuide.categories, severity.text,
     * guideItems.edges … ). The DATA is equivalent; the field names are not.
     *
     * This endpoint is undocumented and unsupported. It may throttle, change its
     * schema, require persisted queries, or block ad-hoc queries at any time. If it
     * does, you'll get a clear error + a "raw JSON" button to inspect the response.
     */

    (function () {
        'use strict';

        /* ------------------------------------------------------------------ *
         *  Config
         * ------------------------------------------------------------------ */
        const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // cache IMDb data for 7 days
        const CACHE_PREFIX = 'ptp_pg_cache_';
        const PREF_BOX_COLLAPSED = 'ptp_pg_box_collapsed';
        const PREF_CAT_COLLAPSED = 'ptp_pg_cat_collapsed'; // JSON map {CATID:true}
        const GQL_ENDPOINT = 'https://api.graphql.imdb.com/';
        // IMDb's web client identifies itself with this header.
        const GQL_CLIENT_NAME = 'imdb-web-next-localized';
        // Preferred certificate country, in priority order. 'GB' = UK/BBFC. The badge
        // uses the first match found; if none of these exist for a title it falls back
        // to whatever default certificate the parents-guide query returns (usually US).
        const CERT_PREF = ['GB', 'US'];
        const LOG = (...a) => console.log('[PTP-PG]', ...a);

        const CAT_META = {
            NUDITY:      { icon: '🔞', order: 0 },
            VIOLENCE:    { icon: '🔪', order: 1 },
            PROFANITY:   { icon: '🤬', order: 2 },
            ALCOHOL:     { icon: '🍸', order: 3 },
            FRIGHTENING: { icon: '😱', order: 4 }
        };

        const SEV = {
            'None':     { color: '#4caf50', rank: 0 },
            'Mild':     { color: '#d4c11e', rank: 1 },
            'Moderate': { color: '#ff9800', rank: 2 },
            'Severe':   { color: '#f4433f', rank: 3 }
        };
        const SEV_UNKNOWN = { color: '#8a94a6', rank: -1 };

        /* ------------------------------------------------------------------ *
         *  Helpers
         * ------------------------------------------------------------------ */
        function sevInfo(level) { return (level && SEV[level]) || SEV_UNKNOWN; }
        function loadPref(k, d) { try { return GM_getValue(k, d); } catch (e) { return d; } }
        function savePref(k, v) { try { GM_setValue(k, v); } catch (e) {} }
        function delPref(k)     { try { GM_deleteValue(k); } catch (e) {} }

        function getCatCollapsedMap() {
            try { return JSON.parse(loadPref(PREF_CAT_COLLAPSED, '{}')) || {}; }
            catch (e) { return {}; }
        }
        function setCatCollapsed(catId, collapsed) {
            const m = getCatCollapsedMap();
            if (collapsed) m[catId] = true; else delete m[catId];
            savePref(PREF_CAT_COLLAPSED, JSON.stringify(m));
        }

        function sanitize(html) {
            const t = document.createElement('div');
            t.innerHTML = html || '';
            t.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(n => n.remove());
            t.querySelectorAll('*').forEach(el => {
                [...el.attributes].forEach(a => {
                    const n = a.name.toLowerCase();
                    if (n.startsWith('on') || (n === 'href' && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
                });
            });
            return t.innerHTML;
        }
        function escapeHtml(s) {
            return (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
        }

        function el(tag, cls, html) {
            const e = document.createElement(tag);
            if (cls) e.className = cls;
            if (html != null) e.innerHTML = html;
            return e;
        }
        function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }

        /* ------------------------------------------------------------------ *
         *  Find the IMDb id on the PTP page
         * ------------------------------------------------------------------ */
        function findImdbId() {
            const a = document.querySelector('a[href*="imdb.com/title/tt"]');
            if (a) { const m = a.href.match(/tt\d{7,9}/); if (m) return m[0]; }
            const m2 = document.documentElement.innerHTML.match(/imdb\.com\/title\/(tt\d{7,9})/);
            return m2 ? m2[1] : null;
        }

        /* ------------------------------------------------------------------ *
         *  Networking — GraphQL POST only
         * ------------------------------------------------------------------ */
        function gmPostJson(url, bodyObj, extraHeaders) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: url,
                    headers: Object.assign({
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }, extraHeaders || {}),
                    data: JSON.stringify(bodyObj),
                    timeout: 8000,
                    onload: (r) => resolve(r),
                    onerror: () => reject(new Error('Network error contacting IMDb GraphQL')),
                    ontimeout: () => reject(new Error('IMDb GraphQL request timed out'))
                });
            });
        }

        /* ------------------------------------------------------------------ *
         *  GraphQL query — shaped to the internal endpoint's schema
         * ------------------------------------------------------------------ */
        const PG_QUERY = `
          query PTP_ParentsGuide($id: ID!) {
            title(id: $id) {
              id
              certificate { rating }
              parentsGuide {
                categories {
                  category { id text }
                  severity { text votedFor }
                  totalSeverityVotes
                }
                guideItems(first: 200) {
                  edges {
                    node {
                      category { id }
                      text { plaidHtml }
                      isSpoiler
                    }
                  }
                }
              }
            }
          }`;

        // Normalise a GraphQL data.title object into our render shape.
        function normalizeTitle(title) {
            const pg = title && title.parentsGuide;
            const certificate = (title && title.certificate && title.certificate.rating) || null;
            if (!pg) return { ok: false, reason: 'No parents-guide data for this title.', certificate };

            const sevByCat = {};
            (pg.categories || []).forEach(c => {
                const id = c && c.category && c.category.id; if (!id) return;
                sevByCat[id] = {
                    label: c.category.text,
                    level: (c.severity && c.severity.text) || null,
                    votedFor: (c.severity && c.severity.votedFor) || 0,
                    total: c.totalSeverityVotes || 0
                };
            });

            // guideItems is a single connection; each node carries its category + spoiler flag.
            const itemsByCat = {};
            ((pg.guideItems && pg.guideItems.edges) || []).forEach(e => {
                const node = e && e.node; if (!node) return;
                const id = node.category && node.category.id; if (!id) return;
                const html = node.text && node.text.plaidHtml; if (!html) return;
                (itemsByCat[id] = itemsByCat[id] || []).push({ html, spoiler: !!node.isSpoiler });
            });

            const ids = new Set([...Object.keys(sevByCat), ...Object.keys(itemsByCat)]);
            const categories = [...ids].map(id => {
                const s = sevByCat[id] || {};
                const items = (itemsByCat[id] || []).slice()
                    .sort((a, b) => (a.spoiler ? 1 : 0) - (b.spoiler ? 1 : 0)); // non-spoilers first
                return {
                    id, label: s.label || id, level: s.level || null,
                    votedFor: s.votedFor || 0, total: s.total || 0,
                    items
                };
            }).sort((a, b) => (CAT_META[a.id]?.order ?? 99) - (CAT_META[b.id]?.order ?? 99));

            const hasAny = categories.some(c => c.level || c.items.length);
            if (!hasAny) return { ok: false, reason: 'No parents-guide entries submitted for this title yet.', certificate };
            return { ok: true, certificate, categories };
        }

        async function fetchViaGraphQL(ttId) {
            const body = { query: PG_QUERY, operationName: 'PTP_ParentsGuide', variables: { id: ttId } };
            let r;
            try {
                r = await gmPostJson(GQL_ENDPOINT, body, { 'x-imdb-client-name': GQL_CLIENT_NAME });
            } catch (e) {
                return { ok: false, reason: e.message || 'GraphQL network error', source: 'graphql' };
            }
            LOG('graphql status', r.status, 'len', (r.responseText || '').length);
            if (r.status === 202 || !(r.responseText || '').trim())
                return { ok: false, reason: 'GraphQL endpoint throttled/empty (HTTP ' + r.status + ').', source: 'graphql' };
            if (r.status >= 400)
                return { ok: false, reason: 'GraphQL endpoint returned HTTP ' + r.status + '.', source: 'graphql', rawText: r.responseText };

            let json;
            try { json = JSON.parse(r.responseText); }
            catch (e) { return { ok: false, reason: 'GraphQL response was not JSON.', source: 'graphql', rawText: r.responseText }; }

            if (json.errors && json.errors.length) {
                return { ok: false, reason: 'GraphQL errors: ' + json.errors.map(e => e.message).join('; '),
                         source: 'graphql', raw: json };
            }
            const title = json && json.data && json.data.title;
            if (!title) return { ok: false, reason: 'GraphQL returned no title data.', source: 'graphql', raw: json };

            const norm = normalizeTitle(title);
            norm.source = 'graphql';
            norm.raw = json;          // keep the raw payload for the "show raw JSON" viewer
            return norm;
        }

        /* ------------------------------------------------------------------ *
         *  Certificates by country (separate request — see note below)
         *  Run independently so an unknown field name here can't break the
         *  parents-guide query. Picks the first country in CERT_PREF.
         * ------------------------------------------------------------------ */
        const CERT_QUERY = `
          query PTP_Certs($id: ID!) {
            title(id: $id) {
              certificates(first: 80) {
                edges {
                  node {
                    rating
                    country { id text }
                    ratingsBody { id }
                  }
                }
              }
            }
          }`;

        async function fetchPreferredCert(ttId) {
            let r;
            try {
                r = await gmPostJson(GQL_ENDPOINT,
                    { query: CERT_QUERY, operationName: 'PTP_Certs', variables: { id: ttId } },
                    { 'x-imdb-client-name': GQL_CLIENT_NAME });
            } catch (e) { LOG('cert request failed', e && e.message); return null; }
            if (r.status >= 400 || !(r.responseText || '').trim()) { LOG('cert http', r.status); return null; }
            let j;
            try { j = JSON.parse(r.responseText); } catch (e) { return null; }
            if (j.errors && j.errors.length) { LOG('cert query rejected:', j.errors.map(e => e.message).join('; ')); return null; }
            const edges = (j && j.data && j.data.title && j.data.title.certificates && j.data.title.certificates.edges) || [];
            const byCountry = {};
            edges.forEach(e => {
                const n = e && e.node; if (!n) return;
                const c = n.country && n.country.id; if (!c) return;
                if (!byCountry[c]) byCountry[c] = { rating: n.rating, body: (n.ratingsBody && n.ratingsBody.id) || null };
            });
            for (const c of CERT_PREF) {
                if (byCountry[c] && byCountry[c].rating) return { country: c, rating: byCountry[c].rating, body: byCountry[c].body };
            }
            return null;
        }

        /* ------------------------------------------------------------------ *
         *  Fetch with cache (GraphQL only)
         * ------------------------------------------------------------------ */
        const inflight = {};
        function fetchGuide(ttId, force) {
            if (!force && inflight[ttId]) return inflight[ttId];
            const p = _fetchGuide(ttId, force).finally(() => { if (inflight[ttId] === p) delete inflight[ttId]; });
            inflight[ttId] = p;
            return p;
        }

        async function _fetchGuide(ttId, force) {
            const cacheKey = CACHE_PREFIX + ttId;
            if (!force) {
                try {
                    const cached = JSON.parse(loadPref(cacheKey, 'null'));
                    if (cached && cached.data && (Date.now() - cached.at) < CACHE_TTL_MS) return cached.data;
                } catch (e) {}
            }
            let res;
            try { res = await fetchViaGraphQL(ttId); }
            catch (e) { res = { ok: false, reason: (e && e.message) || 'GraphQL failed', source: 'graphql' }; }
            if (res.ok) {
                // Try to swap the default (US) certificate for the preferred country (UK).
                try {
                    const c = await fetchPreferredCert(ttId);
                    if (c) { res.certificate = c.rating; res.certCountry = c.country; res.certBody = c.body; }
                } catch (e) { LOG('cert override skipped', e && e.message); }
                savePref(cacheKey, JSON.stringify({ at: Date.now(), data: res }));
            }
            return res;
        }

        /* ------------------------------------------------------------------ *
         *  Rendering
         * ------------------------------------------------------------------ */
        function fullLink(ttId) {
            const p = el('div', 'pg-fulllink');
            p.innerHTML = '<a href="https://www.imdb.com/title/' + ttId +
                '/parentalguide/" target="_blank" rel="noopener">View full guide on IMDb →</a>';
            return p;
        }

        function sourceBadge() {
            return '<span class="pg-src" title="Fetched from IMDb\'s internal GraphQL endpoint">GraphQL API</span>';
        }

        function certSpan(data) {
            if (!data || !data.certificate) return null;
            const country = data.certCountry ? data.certCountry + ' ' : '';
            const tip = (data.certBody ? data.certBody : (data.certCountry || '')) + ' rating';
            const s = el('span', 'pg-cert', escapeHtml(country + data.certificate));
            s.title = tip.trim();
            return s;
        }

        function rawViewer(data) {
            if (!data || (!data.raw && !data.rawText)) return null;
            const wrap = el('div', 'pg-raw-wrap');
            const btn = el('button', 'pg-raw-toggle', '{ } Show raw GraphQL response');
            const pre = el('pre', 'pg-raw');
            pre.style.display = 'none';
            let filled = false;
            btn.addEventListener('click', () => {
                const hidden = pre.style.display === 'none';
                if (hidden && !filled) {
                    try { pre.textContent = data.raw ? JSON.stringify(data.raw, null, 2) : String(data.rawText); }
                    catch (e) { pre.textContent = String(data.rawText || data.raw); }
                    filled = true;
                }
                pre.style.display = hidden ? '' : 'none';
                btn.textContent = (hidden ? '{ } Hide raw GraphQL response' : '{ } Show raw GraphQL response');
            });
            wrap.appendChild(btn);
            wrap.appendChild(pre);
            return wrap;
        }

        function buildBox(ttId) {
            const box = el('div', 'panel pg-box');
            box.id = 'ptp-parents-guide';

            const head = el('div', 'panel__heading pg-head');
            const collapsedBox = loadPref(PREF_BOX_COLLAPSED, false);
            head.innerHTML =
                '<span class="pg-caret">' + (collapsedBox ? '▸' : '▾') + '</span>' +
                '<span class="panel__heading__title">🎬 IMDb Parents Guide</span>' +
                '<span class="pg-head-right"></span>';

            const body = el('div', 'panel__body pg-body');
            if (collapsedBox) body.style.display = 'none';

            head.addEventListener('click', () => {
                const hidden = body.style.display === 'none';
                body.style.display = hidden ? '' : 'none';
                head.querySelector('.pg-caret').textContent = hidden ? '▾' : '▸';
                savePref(PREF_BOX_COLLAPSED, !hidden);
            });

            box.appendChild(head);
            box.appendChild(body);
            load(box, head, body, ttId, false);
            return box;
        }

        function load(box, head, body, ttId, force) {
            body.innerHTML = '';
            body.appendChild(el('div', 'pg-status', 'Loading parents guide…'));
            fetchGuide(ttId, force)
                .then(res => res.ok ? renderData(box, head, body, res, ttId)
                                    : renderMessage(box, head, body, ttId, res))
                .catch(err => {
                    LOG('error', err);
                    renderMessage(box, head, body, ttId, { reason: (err && err.message) || 'Unknown error', certificate: null }, true);
                });
        }

        function renderMessage(box, head, body, ttId, res, isError) {
            body.innerHTML = '';
            const rightM = head.querySelector('.pg-head-right');
            rightM.innerHTML = '';
            const cM = certSpan(res); if (cM) rightM.appendChild(cM);
            const s = el('div', 'pg-status' + (isError ? ' pg-error' : ''),
                (isError ? '⚠️ ' : '') + (res.reason || 'No data.'));
            body.appendChild(s);
            if (/202|throttl|http 4|http 5|persisted|not json|no title/i.test(res.reason || '')) {
                body.appendChild(el('div', 'pg-hint',
                    'The internal GraphQL endpoint is undocumented and may block ad-hoc queries or require a persisted-query hash. Use the "raw GraphQL response" button to see exactly what it returned, then adjust the query if needed.'));
            }
            const rv = rawViewer(res);
            if (rv) body.appendChild(rv);
            const retry = el('button', 'pg-retry', '↻ Retry');
            retry.addEventListener('click', () => { delPref(CACHE_PREFIX + ttId); load(box, head, body, ttId, true); });
            body.appendChild(retry);
            body.appendChild(fullLink(ttId));
        }

        function renderData(box, head, body, data, ttId) {
            body.innerHTML = '';
            let worst = SEV_UNKNOWN, worstLevel = null;
            data.categories.forEach(c => {
                const inf = sevInfo(c.level);
                if (inf.rank > worst.rank) { worst = inf; worstLevel = c.level; }
            });
            box.style.setProperty('--pg-accent', worst.color);

            const right = head.querySelector('.pg-head-right');
            right.innerHTML = '';
            right.insertAdjacentHTML('beforeend', sourceBadge());
            const cD = certSpan(data); if (cD) right.appendChild(cD);
            if (worstLevel) { const o = el('span', 'pg-overall', worstLevel); o.style.background = worst.color; right.appendChild(o); }

            const catCollapsed = getCatCollapsedMap();

            data.categories.forEach(cat => {
                const meta = CAT_META[cat.id] || { icon: '•' };
                const inf = sevInfo(cat.level);
                const hasItems = cat.items.length > 0;

                const catEl = el('div', 'pg-cat');
                catEl.style.setProperty('--sev', inf.color);

                let collapsed = (cat.id in catCollapsed) ? catCollapsed[cat.id] : (cat.level === 'None' || !hasItems);

                const cHead = el('div', 'pg-cat-head');
                cHead.innerHTML =
                    '<span class="pg-cat-caret">' + (collapsed ? '▸' : '▾') + '</span>' +
                    '<span class="pg-cat-icon">' + meta.icon + '</span>' +
                    '<span class="pg-cat-label">' + escapeHtml(cat.label) + '</span>' +
                    '<span class="pg-sev-badge">' + (cat.level || '—') + '</span>';

                const cBody = el('div', 'pg-cat-body');
                if (collapsed) cBody.style.display = 'none';

                if (cat.total > 0) {
                    const vp = pct(cat.votedFor, cat.total);
                    const bar = el('div', 'pg-votebar');
                    bar.title = cat.votedFor + ' of ' + cat.total + ' voters (' + vp + '%)';
                    const fill = el('div', 'pg-votebar-fill');
                    fill.style.width = vp + '%'; fill.style.background = inf.color;
                    bar.appendChild(fill);
                    cBody.appendChild(bar);
                    cBody.appendChild(el('div', 'pg-votemeta', cat.votedFor + '/' + cat.total + ' voters (' + vp + '%)'));
                }

                if (hasItems) {
                    const ul = el('ul', 'pg-items');
                    cat.items.forEach(item => {
                        const li = el('li', 'pg-item' + (item.spoiler ? ' pg-spoiler' : ''));
                        li.innerHTML = sanitize(item.html);
                        if (item.spoiler) { li.title = 'Spoiler — click to reveal'; li.addEventListener('click', () => li.classList.toggle('revealed')); }
                        ul.appendChild(li);
                    });
                    cBody.appendChild(ul);
                } else {
                    cBody.appendChild(el('div', 'pg-noitems', 'No detailed notes listed.'));
                }

                cHead.addEventListener('click', () => {
                    const hidden = cBody.style.display === 'none';
                    cBody.style.display = hidden ? '' : 'none';
                    cHead.querySelector('.pg-cat-caret').textContent = hidden ? '▾' : '▸';
                    setCatCollapsed(cat.id, !hidden);
                });

                catEl.appendChild(cHead);
                catEl.appendChild(cBody);
                body.appendChild(catEl);
            });

            const rv = rawViewer(data);
            if (rv) body.appendChild(rv);
            body.appendChild(fullLink(ttId));
        }

        /* ------------------------------------------------------------------ *
         *  Injection (resilient to timing)
         * ------------------------------------------------------------------ */
        function placeBox(box) {
            const synopsis = document.getElementById('synopsis-and-trailer');
            if (synopsis && synopsis.parentNode) { synopsis.parentNode.insertBefore(box, synopsis); return true; }
            const mainCol = document.querySelector('.main-column');
            if (mainCol) { mainCol.insertBefore(box, mainCol.firstChild); return true; }
            const sidebar = document.querySelector('.sidebar');
            if (sidebar) { sidebar.insertBefore(box, sidebar.firstChild); return true; }
            return false;
        }

        function tryInject() {
            if (document.getElementById('ptp-parents-guide')) return true;
            const ttId = findImdbId();
            if (!ttId) return false;
            if (!document.getElementById('synopsis-and-trailer') && !document.querySelector('.main-column')) return false;
            const box = buildBox(ttId);
            const placed = placeBox(box);
            if (placed) LOG('injected for', ttId);
            return placed;
        }

        function start() {
            const ttEarly = findImdbId();
            if (ttEarly) fetchGuide(ttEarly, false);

            if (tryInject()) return;
            let done = false;
            const finish = () => { done = true; obs.disconnect(); clearInterval(poll); clearTimeout(stop); };
            const obs = new MutationObserver(() => { if (!done && tryInject()) finish(); });
            obs.observe(document.body, { childList: true, subtree: true });
            const poll = setInterval(() => { if (!done && tryInject()) finish(); }, 800);
            const stop = setTimeout(() => { if (!done) { finish(); LOG('gave up: no IMDb link / target found'); } }, 12000);
        }

        /* ------------------------------------------------------------------ *
         *  Styles (dark-theme friendly to match PTP)
         * ------------------------------------------------------------------ */
        GM_addStyle(`
            #ptp-parents-guide { --pg-accent:#8a94a6; overflow:hidden; }
            #ptp-parents-guide .pg-head { display:flex; align-items:center; gap:6px; cursor:pointer; border-left:4px solid var(--pg-accent); }
            #ptp-parents-guide .pg-caret { width:12px; display:inline-block; opacity:.8; }
            #ptp-parents-guide .pg-head-right { margin-left:auto; display:flex; gap:6px; align-items:center; }
            #ptp-parents-guide .pg-cert { font-size:11px; font-weight:700; letter-spacing:.3px; border:1px solid currentColor; border-radius:3px; padding:0 5px; opacity:.85; }
            #ptp-parents-guide .pg-overall { font-size:11px; font-weight:700; color:#0e0e0e; border-radius:3px; padding:1px 6px; }
            #ptp-parents-guide .pg-src { font-size:10px; font-weight:600; opacity:.6; border:1px solid rgba(255,255,255,.2); border-radius:3px; padding:0 5px; }

            #ptp-parents-guide .pg-body { display:flex; flex-wrap:wrap; gap:8px; align-items:flex-start; padding:10px; }
            #ptp-parents-guide .pg-status { flex:1 1 100%; padding:6px 2px; opacity:.85; font-size:12px; }
            #ptp-parents-guide .pg-error { color:#ff8a80; }
            #ptp-parents-guide .pg-retry { cursor:pointer; font:inherit; font-size:11px; padding:3px 10px; border-radius:4px; border:1px solid rgba(255,255,255,.25); background:rgba(255,255,255,.06); color:inherit; }
            #ptp-parents-guide .pg-retry:hover { background:rgba(255,255,255,.14); }

            #ptp-parents-guide .pg-cat { flex:1 1 200px; min-width:190px; align-self:stretch; border:1px solid rgba(255,255,255,.08); border-top:3px solid var(--sev); border-radius:4px; background:rgba(255,255,255,.03); overflow:hidden; }
            #ptp-parents-guide .pg-cat-head { display:flex; align-items:center; gap:6px; cursor:pointer; padding:6px 8px; user-select:none; }
            #ptp-parents-guide .pg-cat-head:hover { background:rgba(255,255,255,.05); }
            #ptp-parents-guide .pg-cat-caret { width:11px; opacity:.7; font-size:11px; }
            #ptp-parents-guide .pg-cat-icon { font-size:14px; }
            #ptp-parents-guide .pg-cat-label { flex:1 1 auto; font-weight:600; font-size:12px; line-height:1.2; }
            #ptp-parents-guide .pg-sev-badge { font-size:10px; font-weight:700; color:#0e0e0e; background:var(--sev); border-radius:3px; padding:1px 6px; white-space:nowrap; }
            #ptp-parents-guide .pg-cat-body { padding:6px 8px 8px; }

            #ptp-parents-guide .pg-votebar { height:5px; border-radius:3px; background:rgba(255,255,255,.1); overflow:hidden; margin:2px 0 3px; }
            #ptp-parents-guide .pg-votebar-fill { height:100%; }
            #ptp-parents-guide .pg-votemeta { font-size:10px; opacity:.6; margin-bottom:5px; }

            #ptp-parents-guide .pg-items { list-style:none; margin:0; padding:0; }
            #ptp-parents-guide .pg-item { font-size:12px; line-height:1.4; padding:4px 0; border-top:1px solid rgba(255,255,255,.06); }
            #ptp-parents-guide .pg-item:first-child { border-top:none; }
            #ptp-parents-guide .pg-item a { text-decoration:underline; }
            #ptp-parents-guide .pg-noitems { font-size:11px; opacity:.55; padding:2px 0; }

            #ptp-parents-guide .pg-spoiler { filter:blur(4px); cursor:pointer; transition:filter .15s; background:rgba(244,67,63,.06); border-radius:3px; }
            #ptp-parents-guide .pg-spoiler::after { content:" 🔒 spoiler"; font-size:9px; opacity:.7; }
            #ptp-parents-guide .pg-spoiler.revealed { filter:none; background:transparent; }
            #ptp-parents-guide .pg-spoiler.revealed::after { content:""; }

            #ptp-parents-guide .pg-fulllink { flex:1 1 100%; margin-top:2px; font-size:11px; text-align:right; }
            #ptp-parents-guide .pg-hint { flex:1 1 100%; font-size:11px; opacity:.7; line-height:1.4; margin:2px 0 6px; }

            #ptp-parents-guide .pg-raw-wrap { flex:1 1 100%; margin-top:4px; }
            #ptp-parents-guide .pg-raw-toggle { cursor:pointer; font:inherit; font-size:11px; padding:3px 10px; border-radius:4px; border:1px solid rgba(255,255,255,.25); background:rgba(255,255,255,.06); color:inherit; }
            #ptp-parents-guide .pg-raw-toggle:hover { background:rgba(255,255,255,.14); }
            #ptp-parents-guide .pg-raw { max-height:320px; overflow:auto; margin:6px 0 0; padding:8px; font-family:monospace; font-size:11px; line-height:1.35; white-space:pre; background:rgba(0,0,0,.35); border:1px solid rgba(255,255,255,.1); border-radius:4px; }
        `);

        /* ------------------------------------------------------------------ *
         *  Go
         * ------------------------------------------------------------------ */
        start();
    })();
    }

    /* ================================================================== *
     *  PTP Trailer Modal v2.0  --  torrents.php
     * ================================================================== */
    function MOD_trailerModal() {
    (function () {
      'use strict';

      const trailer = document.querySelector('.movie-page__trailer');
      if (!trailer) return;

      // Pull the video id from whatever embed PTP put in place.
      const iframe = trailer.querySelector('iframe');
      let videoId = null;
      if (iframe && iframe.src) {
        const m = iframe.src.match(/(?:embed\/|v=|youtu\.be\/)([\w-]{11})/);
        if (m) videoId = m[1];
      }

      // Remove the broken inline trailer panel entirely.
      trailer.remove();

      if (!videoId) return; // no trailer to show

      // --- Add a [YouTube] link into the actions row (.linkbox) ---
      const linkbox = document.querySelector('.linkbox');
      const link = document.createElement('a');
      link.className = 'linkbox__link';
      link.href = '#';
      // Match the [bracketed] style of siblings; "Y" red, rest white.
      link.innerHTML = '[<span style="color:#FF0000;">Y</span>' +
                       '<span style="color:#FFFFFF;">ouTube</span>]';

      if (linkbox) {
        linkbox.appendChild(document.createTextNode('\n'));
        linkbox.appendChild(link);
      } else {
        // Fallback: float it near the title if the linkbox isn't found.
        link.style.marginLeft = '8px';
        (document.querySelector('.page__title') || document.body).appendChild(link);
      }

      // --- Modal (built once, on demand) ---
      let overlay = null;

      function buildModal() {
        overlay = document.createElement('div');
        Object.assign(overlay.style, {
          position: 'fixed',
          inset: '0',
          background: 'rgba(0,0,0,0.8)',
          display: 'none',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: '2147483647',
          opacity: '0',
          transition: 'opacity 0.15s ease'
        });

        const box = document.createElement('div');
        Object.assign(box.style, {
          position: 'relative',
          width: 'min(90vw, 960px)',
          aspectRatio: '16 / 9',
          background: '#000',
          borderRadius: '8px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
          overflow: 'hidden'
        });

        const close = document.createElement('button');
        close.type = 'button';
        close.setAttribute('aria-label', 'Close');
        close.textContent = '✕';
        Object.assign(close.style, {
          position: 'absolute',
          top: '-14px',
          right: '-14px',
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          border: 'none',
          background: '#FF0000',
          color: '#fff',
          fontSize: '16px',
          lineHeight: '36px',
          cursor: 'pointer',
          zIndex: '1',
          boxShadow: '0 2px 6px rgba(0,0,0,0.5)'
        });

        box.appendChild(close);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const hide = () => {
          overlay.style.opacity = '0';
          const f = box.querySelector('iframe');
          if (f) f.remove(); // stops playback
          setTimeout(() => { overlay.style.display = 'none'; }, 150);
          document.removeEventListener('keydown', onKey);
        };
        const onKey = (e) => { if (e.key === 'Escape') hide(); };

        close.addEventListener('click', hide);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) hide(); });

        overlay._show = () => {
          const f = document.createElement('iframe');
          // referrerPolicy override is the key fix: PTP sets a page-wide
          // <meta name="referrer" content="no-referrer">, which strips the
          // Referer header and makes YouTube reject the embed (Error 153).
          f.referrerPolicy = 'strict-origin-when-cross-origin';
          f.src = 'https://www.youtube.com/embed/' + videoId +
                  '?autoplay=1&rel=0&origin=' + encodeURIComponent(location.origin);
          f.width = '100%';
          f.height = '100%';
          f.style.border = '0';
          f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
          f.allowFullscreen = true;
          box.insertBefore(f, close.nextSibling);

          overlay.style.display = 'flex';
          requestAnimationFrame(() => { overlay.style.opacity = '1'; });
          document.addEventListener('keydown', onKey);
        };
      }

      link.addEventListener('click', (e) => {
        e.preventDefault();
        if (!overlay) buildModal();
        overlay._show();
      });
    })();
    }

    /* ================================================================== *
     *  PTP Radarr Integration v0.3.2  --  torrents.php + user.php?action=edit
     * ================================================================== */
    function MOD_radarr() {
    (function () {
      'use strict';

      // Two entry points:
      //   • torrents.php  → movie pages: render the slim [Server Name] linkbar entries.
      //   • user.php (action=edit) → the settings tab where servers are configured.
      // Anything else: do nothing. (Belt-and-suspenders alongside @match.)
      const IS_MOVIE_PAGE = /^\/torrents\.php\b/i.test(location.pathname);
      const IS_SETTINGS_PAGE = /^\/user\.php\b/i.test(location.pathname) && /action=edit/i.test(location.search);
      if (!IS_MOVIE_PAGE && !IS_SETTINGS_PAGE) return;

      /* =========================================================================
       * CONFIG — adjust here if the entries land in the wrong place
       * -------------------------------------------------------------------------
       * The Radarr entries are appended, inline, to PTP's linkbar — the row of
       * [Edit description] [View history] [Bookmark] … links under the movie header
       * (div.linkbox, each entry an <a class="linkbox__link">). LINKBAR_SELECTORS is
       * tried in order; the first element found is used. If PTP ever renames it,
       * add the new selector to the FRONT of this list.
       * =======================================================================*/
      const CONFIG = {
        LINKBAR_SELECTORS: [
          'div.linkbox',
          '.linkbox'
        ],
        // Class PTP puts on each linkbar entry, so ours inherit the native styling.
        LINK_CLASS: 'linkbox__link'
      };

      /* =========================================================================
       * Storage
       * =======================================================================*/
      const STORE_KEY = 'ptp_radarr_servers_v1';

      // Cross-manager storage. Tampermonkey/Violentmonkey expose synchronous GM_getValue/
      // GM_setValue; Safari's "Userscripts" app only exposes the async GM.getValue/GM.setValue
      // (Promise-based). We hydrate an in-memory cache once at boot so the rest of the code can
      // stay synchronous, and persist writes through whichever API exists.
      const GMstore = {
        get(key, def) {
          if (typeof GM_getValue === 'function') return Promise.resolve(GM_getValue(key, def));
          if (typeof GM !== 'undefined' && GM && typeof GM.getValue === 'function') return Promise.resolve(GM.getValue(key, def));
          try { const v = localStorage.getItem('GM_' + key); return Promise.resolve(v == null ? def : v); }
          catch (e) { return Promise.resolve(def); }
        },
        set(key, val) {
          if (typeof GM_setValue === 'function') { try { GM_setValue(key, val); } catch (e) {} return Promise.resolve(); }
          if (typeof GM !== 'undefined' && GM && typeof GM.setValue === 'function') return Promise.resolve(GM.setValue(key, val));
          try { localStorage.setItem('GM_' + key, val); } catch (e) {}
          return Promise.resolve();
        }
      };

      let serversCache = [];
      function parseServers(raw) {
        try { const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a : []; }
        catch (e) { return []; }
      }
      async function initStorage() {
        const raw = await GMstore.get(STORE_KEY, '[]');
        serversCache = parseServers(raw);
      }
      function loadServers() {
        // hand back independent copies so callers can mutate freely before saving
        return serversCache.map(s => Object.assign({}, s));
      }
      function saveServers(list) {
        serversCache = list.map(s => Object.assign({}, s));
        GMstore.set(STORE_KEY, JSON.stringify(serversCache));
      }
      function newId() {
        return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      }
      function blankServer() {
        return {
          id: newId(),
          name: '',
          url: '',
          apiKey: '',
          qualityProfileId: null,
          rootFolderPath: '',
          minimumAvailability: 'released', // Radarr: tba | announced | inCinemas | released
          monitored: true,
          searchOnAdd: true,
          // cached lookups (not authoritative)
          _profiles: [],
          _rootFolders: [],
          _version: null
        };
      }

      /* =========================================================================
       * Radarr API helper (uses GM_xmlhttpRequest to bypass CORS / mixed content)
       * =======================================================================*/
      function normBase(url) {
        let u = (url || '').trim();
        if (!u) return '';
        if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
        return u.replace(/\/+$/, '');
      }

      // Tampermonkey exposes GM_xmlhttpRequest; Safari's Userscripts exposes GM.xmlHttpRequest.
      function gmXhr(opts) {
        if (typeof GM_xmlhttpRequest === 'function') return GM_xmlhttpRequest(opts);
        if (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function') return GM.xmlHttpRequest(opts);
        throw new Error('No GM_xmlhttpRequest / GM.xmlHttpRequest available — check the userscript @grant lines');
      }

      function radarrRequest(server, path, { method = 'GET', body = null } = {}) {
        const base = normBase(server.url);
        const url = base + path;
        return new Promise((resolve, reject) => {
          gmXhr({
            method,
            url,
            headers: {
              'X-Api-Key': (server.apiKey || '').trim(),
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            data: body ? JSON.stringify(body) : undefined,
            timeout: 15000,
            onload: (res) => {
              let data = null;
              try { data = res.responseText ? JSON.parse(res.responseText) : null; } catch (e) {}
              if (res.status >= 200 && res.status < 300) {
                resolve({ status: res.status, data });
              } else {
                reject({
                  status: res.status,
                  message: (data && (Array.isArray(data) ? (data[0] && data[0].errorMessage) : (data.message || data.error))) ||
                           (res.status === 401 ? 'Unauthorized — check the API key' :
                            res.status === 404 ? 'Endpoint not found — check the URL / base path' :
                            'HTTP ' + res.status),
                  data
                });
              }
            },
            ontimeout: () => reject({ status: 0, message: 'Request timed out (15s)' }),
            onerror: () => reject({ status: 0, message: 'Network error — URL unreachable, or Radarr not running' })
          });
        });
      }

      const RadarrAPI = {
        status: (s) => radarrRequest(s, '/api/v3/system/status'),
        qualityProfiles: (s) => radarrRequest(s, '/api/v3/qualityprofile'),
        rootFolders: (s) => radarrRequest(s, '/api/v3/rootfolder'),
        lookup: (s, term) => radarrRequest(s, '/api/v3/movie/lookup?term=' + encodeURIComponent(term)),
        movieByTmdb: (s, tmdbId) => radarrRequest(s, '/api/v3/movie?tmdbId=' + encodeURIComponent(tmdbId)),
        addMovie: (s, payload) => radarrRequest(s, '/api/v3/movie', { method: 'POST', body: payload })
      };

      /* =========================================================================
       * Page facts (movie identity for the add flow)
       * =======================================================================*/
      function movieInfo() {
        try {
          // IMDb id — PTP always links out to the IMDb title page.
          const imdbA = document.querySelector('a[href*="imdb.com/title/"]');
          const imdbId = imdbA ? ((imdbA.href.match(/title\/(tt\d+)/i) || [])[1] || null) : null;

          // TMDb id — PTP links to themoviedb.org/movie/<id> when it has one.
          let tmdbId = null;
          const tmdbA = document.querySelector('a[href*="themoviedb.org/movie/"]');
          if (tmdbA) tmdbId = (tmdbA.href.match(/movie\/(\d+)/i) || [])[1] || null;

          // Title + year — from the page heading (e.g. "The Matrix [1999] by …"),
          // falling back to the document title.
          let title = '', year = null;
          const h = document.querySelector('h2.page__title, .page__title, #content h2');
          const raw = (h ? h.textContent : document.title) || '';
          const ym = raw.match(/\[(\d{4})\]/) || raw.match(/\((\d{4})\)/);
          if (ym) year = Number(ym[1]);
          title = raw
            .replace(/\s*\[\d{4}\].*$/, '')     // strip "[year] by director…"
            .replace(/\s*\(\d{4}\).*$/, '')
            .replace(/\s*::\s*PassThePopcorn\s*$/i, '')
            .replace(/\s*-\s*PassThePopcorn\s*$/i, '')
            .trim();

          return { imdbId, tmdbId, title, year };
        } catch (e) {
          console.warn('[PTP-Radarr] movieInfo failed', e);
          return { imdbId: null, tmdbId: null, title: (document.title || '').trim(), year: null };
        }
      }

      /* =========================================================================
       * Styles
       * =======================================================================*/
      const CSS = `
      /* Radarr entries are native .linkbox__link anchors; we only add a cursor and
         let inline colour (set per-status in JS) show connection state. */
      #radarr-inline a.radarr-entry, #radarr-inline a.radarr-cfg { cursor: pointer; }

      /* Config cards embedded in the "PTP Suite" settings panel */
      #radarr-settings { font-family: Verdana, Arial, sans-serif; }
      #radarr-settings .rdr-configcard {
        background: #151922; color: #d8dee9; border: 1px solid #333a45; border-radius: 8px;
        overflow: hidden; display: flex; flex-direction: column; font-size: 13px; max-width: 1080px;
      }
      #radarr-settings .rdr-configcard * { box-sizing: border-box; }

      #radarr-ov {
        position: fixed; inset: 0; background: rgba(0,0,0,.6);
        z-index: 99998; display: none; align-items: flex-start; justify-content: center;
        font-family: Verdana, Arial, sans-serif;
      }
      #radarr-ov.open { display: flex; }
      #radarr-modal {
        background: #1c1f26; color: #d8dee9; margin-top: 6vh; width: 680px; max-width: 94vw;
        max-height: 86vh; border: 1px solid #333a45; border-radius: 8px; overflow: hidden;
        box-shadow: 0 12px 40px rgba(0,0,0,.6); display: flex; flex-direction: column;
        font-size: 13px;
      }
      #radarr-modal * { box-sizing: border-box; }
      .rdr-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 16px; background: #232833; border-bottom: 1px solid #333a45;
      }
      .rdr-head h3 { margin: 0; font-size: 15px; color: #fff; font-weight: 600; letter-spacing:.3px;}
      .rdr-head .rdr-x { cursor: pointer; font-size: 20px; line-height: 1; color: #8b95a5; background:none;border:none;}
      .rdr-head .rdr-x:hover { color: #fff; }
      .rdr-tabs { display: none; }
      .rdr-tab {
        padding: 7px 14px; border: 1px solid #333a45; border-bottom: none; cursor: pointer;
        background: #1c1f26; color: #9aa4b2; border-radius: 6px 6px 0 0; white-space: nowrap;
        display:flex; align-items:center; gap:7px; font-size:12px;
      }
      .rdr-tab.active { background: #2b3240; color: #fff; }
      .rdr-tab .dot, .rdr-cardhead .dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; flex:0 0 auto; display:inline-block; margin-right:6px; }
      .rdr-tab .dot.ok { background: #4caf50; box-shadow: 0 0 5px #4caf50; }
      .rdr-tab .dot.bad { background: #e05555; }
      .rdr-cardhead .dot.ok { background: #4caf50; box-shadow: 0 0 5px #4caf50; }
      .rdr-cardhead .dot.bad { background: #e05555; }
      .rdr-tab-add { color:#8fd67a; font-weight:700; }
      .rdr-body { padding: 18px 20px; overflow-y: auto; }
      .rdr-card {
        background: #1c1f26; border: 1px solid #303845; border-radius: 8px;
        padding: 16px; margin-bottom: 14px; box-shadow: 0 10px 24px rgba(0,0,0,.18);
      }
      .rdr-cardhead {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        margin-bottom: 14px;
      }
      .rdr-cardhead h4 { margin: 0; color: #fff; font-size: 14px; font-weight: 700; }
      .rdr-cardhead p { margin: 3px 0 0; color: #8f9aaa; font-size: 12px; line-height: 1.35; }
      .rdr-feature-grid {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px;
      }
      .rdr-feature {
        display: flex; justify-content: space-between; gap: 14px; align-items: center;
        padding: 12px; border: 1px solid #2d3541; border-radius: 7px; background: #171b23;
      }
      .rdr-feature-title { display:block; color:#f0f4fa; font-weight:700; font-size:12px; }
      .rdr-feature-desc { display:block; color:#8c97a7; font-size:11px; line-height:1.35; margin-top:3px; }
      .rdr-switch { position: relative; width: 46px; height: 24px; flex: 0 0 auto; }
      .rdr-switch input { opacity: 0; width: 0; height: 0; }
      .rdr-slider {
        position: absolute; inset: 0; cursor: pointer; border-radius: 999px;
        background: #3b4350; transition: background .16s ease;
      }
      .rdr-slider::before {
        content: ""; position: absolute; width: 18px; height: 18px; left: 3px; top: 3px;
        border-radius: 50%; background: #dfe6ef; transition: transform .16s ease;
      }
      .rdr-switch input:checked + .rdr-slider { background: #3d7dd6; }
      .rdr-switch input:checked + .rdr-slider::before { transform: translateX(22px); }
      .rdr-server-list { display: grid; gap: 14px; }
      .rdr-server-card { margin-bottom: 0; }
      .rdr-empty { color:#8b95a5; text-align:center; padding: 30px 10px; }
      .rdr-field { margin-bottom: 14px; }
      .rdr-field label { display: block; margin-bottom: 5px; color: #aeb7c4; font-weight: 600; font-size:12px;}
      .rdr-field input[type=text], .rdr-field input[type=url], .rdr-field input[type=password], .rdr-field select {
        width: 100%; padding: 8px 10px; background: #12151b; color: #e6ebf2;
        border: 1px solid #3a424f; border-radius: 5px; font-size: 13px;
      }
      .rdr-field input.rdr-secret { -webkit-text-security: disc; }
      .rdr-field input.rdr-secret.revealed { -webkit-text-security: none; }
      .rdr-field input:focus, .rdr-field select:focus { outline: none; border-color: #5a8bd4; }
      .rdr-row { display:flex; gap: 12px; }
      .rdr-row > .rdr-field { flex: 1; }
      .rdr-inline { display:flex; gap:8px; align-items:center; }
      .rdr-inline input[type=text],.rdr-inline input[type=password]{ flex:1; }
      .rdr-btn {
        padding: 8px 15px; border: none; border-radius: 5px; cursor: pointer; font-size: 13px;
        font-weight: 600; background: #3a4757; color: #dfe6ef;
      }
      .rdr-btn:hover { background: #45566a; }
      .rdr-btn.primary { background: #3d7dd6; color: #fff; }
      .rdr-btn.primary:hover { background: #4a8ae4; }
      .rdr-btn.good { background: #3f9d54; color:#fff; }
      .rdr-btn.danger { background: #7a3535; color:#f2d5d5; }
      .rdr-btn.danger:hover { background: #944040; }
      .rdr-btn:disabled { opacity:.5; cursor: not-allowed; }
      .rdr-toggle { display:flex; align-items:center; gap:8px; cursor:pointer; color:#aeb7c4; }
      .rdr-status {
        margin: 6px 0 16px; padding: 9px 12px; border-radius: 5px; font-size: 12.5px;
        display:none; align-items:center; gap:8px;
      }
      .rdr-status.show { display:flex; }
      .rdr-status.ok  { background: #17361f; color:#9fe6ac; border:1px solid #2f6b3d; }
      .rdr-status.bad { background: #3a1c1c; color:#f0b4b4; border:1px solid #7a3838; }
      .rdr-status.info{ background: #1b2836; color:#b7d2ec; border:1px solid #375473; }
      .rdr-spin { width:13px;height:13px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;display:inline-block;animation:rdrspin .7s linear infinite;}
      @keyframes rdrspin { to { transform: rotate(360deg);} }
      .rdr-foot {
        display:flex; justify-content: space-between; gap: 8px; padding: 12px 20px;
        border-top: 1px solid #333a45; background:#232833;
      }
      .rdr-foot .right { display:flex; gap:8px; }
      .rdr-hint { color:#7d8794; font-size:11px; margin-top:4px; }

      /* add-confirm modal */
      #radarr-add-ov {
        position: fixed; inset: 0; background: rgba(0,0,0,.6);
        z-index: 99999; display: none; align-items: flex-start; justify-content: center;
        font-family: Verdana, Arial, sans-serif;
      }
      #radarr-add-ov.open { display:flex; }
      .rdr-addhead { display:flex; gap:14px; padding:16px 20px; border-bottom:1px solid #333a45; background:#232833; }
      .rdr-addhead img { width:80px; height:auto; border-radius:4px; flex:0 0 auto; background:#12151b; }
      .rdr-addhead .meta h3 { margin:0 0 4px; font-size:16px; color:#fff; }
      .rdr-addhead .meta .sub { color:#9aa4b2; font-size:12px; }
      .rdr-addhead .meta .srv { margin-top:8px; font-size:12px; color:#b7d2ec; }
      `;

      function injectStyle() {
        if (document.getElementById('radarr-style')) return;
        const st = document.createElement('style');
        st.id = 'radarr-style';
        st.textContent = CSS;
        document.head.appendChild(st);
      }

      /* =========================================================================
       * Config UI — lives in its own "PTP Suite" tab on the user Edit Preferences
       * page (user.php?action=edit). The same server list drives the movie-page linkbar.
       * =======================================================================*/
      let servers = loadServers();
      const MIN_AVAIL = ['announced', 'inCinemas', 'released', 'tba'];
      const CFG = '#radarr-settings'; // root of the config UI on the settings page

      // Build the card-based config UI inside the given container.
      function buildConfigInto(root) {
        root.innerHTML = `
          <div class="rdr-configcard">
            <div class="rdr-head"><h3>PTP Suite Settings</h3></div>
            <div class="rdr-body"></div>
          </div>`;
        servers = loadServers();
        if (servers.length === 0) servers.push(blankServer());
        renderBody();
      }

      // Inject a native "PTP Suite" tab into PTP's Edit-Preferences tab bar, with a
      // matching panel that holds the config UI. Tab switching is client-side.
      function injectSettingsTab() {
        if (document.getElementById('radarr-settings')) return true;
        const list = document.querySelector('.tabs__bar__list');
        const panels = document.querySelector('.tabs__panels');
        if (!list || !panels) return false;

        const li = document.createElement('li');
        li.className = 'tabs__bar__item';
        li.id = 'radarr-tab-item';
        const a = document.createElement('a');
        a.className = 'tabs__bar__link';
        a.href = 'javascript:void(0)';
        a.textContent = 'PTP Suite';
        li.appendChild(a);
        list.appendChild(li);

        const panel = document.createElement('div');
        panel.className = 'tabs__panel';
        panel.id = 'radarr-settings';
        panel.style.display = 'none';
        panels.appendChild(panel);
        buildConfigInto(panel);

        a.addEventListener('click', (e) => { e.preventDefault(); activateRadarrTab(); });

        // If the page was opened with #ptp-suite or the older #radarr hash, jump straight to our tab.
        if (/ptp-suite|radarr/i.test(location.hash)) activateRadarrTab();
        return true;
      }

      function activateRadarrTab() {
        document.querySelectorAll('.tabs__bar__item--active').forEach(el => el.classList.remove('tabs__bar__item--active'));
        document.querySelectorAll('.tabs__panel--active').forEach(el => { el.classList.remove('tabs__panel--active'); el.style.display = 'none'; });
        const item = document.getElementById('radarr-tab-item');
        const panel = document.getElementById('radarr-settings');
        if (item) item.classList.add('tabs__bar__item--active');
        if (panel) { panel.classList.add('tabs__panel--active'); panel.style.display = ''; }
      }

      function renderBody() {
        const body = document.querySelector(CFG + ' .rdr-body');
        if (!body) return;
        body.innerHTML = `
          <section class="rdr-card">
            <div class="rdr-cardhead">
              <div>
                <h4>Userscript Features</h4>
                <p>Switch parts of PTP Suite on or off. Changes are saved immediately and apply on the next page load.</p>
              </div>
            </div>
            <div class="rdr-feature-grid"></div>
          </section>
          <section class="rdr-card">
            <div class="rdr-cardhead">
              <div>
                <h4>TMDB Location</h4>
                <p>Used first for watch providers and labels. Latest Digital combines English-language release regions.</p>
              </div>
            </div>
            <div class="rdr-row">
              <div class="rdr-field">
                <label>Region</label>
                <input type="text" data-suite="region" maxlength="2" placeholder="GB" value="${escapeAttr(PTPSuite.tmdbRegion())}">
                <div class="rdr-hint">Use TMDB's 2-letter country code. GB is UK.</div>
              </div>
              <div class="rdr-field">
                <label>Language</label>
                <input type="text" data-suite="language" placeholder="en-GB" value="${escapeAttr(PTPSuite.tmdbLang())}">
                <div class="rdr-hint">Examples: en-GB, en-US, de-DE.</div>
              </div>
            </div>
            <div class="rdr-status" data-el="suite-status"></div>
            <div class="rdr-foot">
              <div></div>
              <div class="right">
                <button class="rdr-btn primary" data-act="save-suite" type="button">Save TMDB settings</button>
              </div>
            </div>
          </section>
          <section class="rdr-card">
            <div class="rdr-cardhead">
              <div>
                <h4>Radarr Servers</h4>
                <p>Each server is shown as its own card. Save when you are finished editing these details.</p>
              </div>
              <button class="rdr-btn good" data-act="add-server" type="button">Add server</button>
            </div>
            <div class="rdr-server-list"></div>
            <div class="rdr-foot">
              <div></div>
              <div class="right">
                <button class="rdr-btn primary" data-act="save" type="button">Save Radarr settings</button>
              </div>
            </div>
          </section>
        `;
        body.querySelector('[data-act="add-server"]').addEventListener('click', () => {
          commitCurrentForm();
          servers.push(blankServer());
          renderServerCards();
        });
        body.querySelector('[data-act="save"]').addEventListener('click', onSaveClick);
        body.querySelector('[data-act="save-suite"]').addEventListener('click', onSaveSuiteClick);
        renderFeatureToggles();
        renderServerCards();
      }

      function setSuiteStatus(kind, html) {
        const el = document.querySelector(CFG + ' [data-el="suite-status"]');
        if (!el) return;
        el.className = 'rdr-status show ' + kind;
        el.innerHTML = html;
      }

      function onSaveSuiteClick() {
        const regionEl = document.querySelector(CFG + ' [data-suite="region"]');
        const langEl = document.querySelector(CFG + ' [data-suite="language"]');
        const region = normalizeRegion(regionEl && regionEl.value);
        const language = String((langEl && langEl.value) || '').trim() || 'en-GB';
        GM_setValue('tmdb_region', region);
        GM_setValue('tmdb_lang', language);
        GM_deleteValue('ptp_latest_digital_cache');
        if (regionEl) regionEl.value = region;
        if (langEl) langEl.value = language;
        setSuiteStatus('ok', `Saved. Latest Digital will use ${regionLabel(region)} after the next page load.`);
      }

      function renderFeatureToggles() {
        const wrap = document.querySelector(CFG + ' .rdr-feature-grid');
        if (!wrap) return;
        wrap.innerHTML = PTPSuite.features.map(f => `
          <label class="rdr-feature">
            <span>
              <span class="rdr-feature-title">${escapeHtml(f.label)}</span>
              <span class="rdr-feature-desc">${escapeHtml(f.desc)}</span>
            </span>
            <span class="rdr-switch">
              <input type="checkbox" data-feature="${escapeAttr(f.key)}" ${PTPSuite.featureEnabled(f.key) ? 'checked' : ''}>
              <span class="rdr-slider"></span>
            </span>
          </label>
        `).join('');
        wrap.querySelectorAll('[data-feature]').forEach(el => {
          el.addEventListener('change', () => PTPSuite.setFeatureEnabled(el.dataset.feature, el.checked));
        });
      }

      function serverCardHtml(s, i) {
        const dotCls = s._live === true ? 'ok' : (s._live === false ? 'bad' : '');
        return `
          <div class="rdr-card rdr-server-card" data-server-index="${i}">
            <div class="rdr-cardhead">
              <div>
                <h4><span class="dot ${dotCls}"></span> ${escapeHtml(s.name || ('Radarr Server ' + (i + 1)))}</h4>
                <p>${escapeHtml(s.url || 'No URL set yet')}</p>
              </div>
              <button class="rdr-btn danger" data-act="delete" type="button">Delete</button>
            </div>
            <div class="rdr-field">
              <label>Server name</label>
              <input type="text" data-f="name" placeholder="e.g. Home Radarr" value="${escapeAttr(s.name)}">
            </div>
            <div class="rdr-field">
              <label>URL</label>
              <input type="text" data-f="url" placeholder="http://192.168.1.50:7878" value="${escapeAttr(s.url)}">
              <div class="rdr-hint">Include http/https, host and port. Add a base path if Radarr sits behind a reverse proxy (e.g. https://host/radarr).</div>
            </div>
            <div class="rdr-field">
              <label>API Key</label>
              <div class="rdr-inline">
                <input type="text" class="rdr-secret" data-f="apiKey" autocomplete="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-form-type="other" placeholder="Radarr → Settings → General → API Key" value="${escapeAttr(s.apiKey)}">
                <button class="rdr-btn" data-act="reveal" type="button">Show</button>
                <button class="rdr-btn primary" data-act="test" type="button">Test</button>
              </div>
            </div>

            <div class="rdr-status" data-el="status"></div>

            <div class="rdr-row">
              <div class="rdr-field">
                <label>Quality Profile</label>
                <select data-f="qualityProfileId"><option value="">— test connection first —</option></select>
              </div>
              <div class="rdr-field">
                <label>Root Folder</label>
                <select data-f="rootFolderPath"><option value="">— test connection first —</option></select>
              </div>
            </div>
            <div class="rdr-row">
              <div class="rdr-field">
                <label>Minimum Availability</label>
                <select data-f="minimumAvailability">
                  ${MIN_AVAIL.map(v=>`<option value="${v}" ${s.minimumAvailability===v?'selected':''}>${v}</option>`).join('')}
                </select>
              </div>
              <div class="rdr-field"></div>
            </div>
            <div class="rdr-field">
              <label class="rdr-toggle"><input type="checkbox" data-f="monitored" ${s.monitored!==false?'checked':''}> Add movies monitored</label>
            </div>
            <div class="rdr-field">
              <label class="rdr-toggle"><input type="checkbox" data-f="searchOnAdd" ${s.searchOnAdd!==false?'checked':''}> Search for movie on add</label>
              <div class="rdr-hint">When adding a movie, tell Radarr to immediately start searching indexers.</div>
            </div>
          </div>
        `;
      }

      function renderServerCards() {
        const list = document.querySelector(CFG + ' .rdr-server-list');
        if (!list) return;
        if (servers.length === 0) servers.push(blankServer());
        list.innerHTML = servers.map(serverCardHtml).join('');

        list.querySelectorAll('.rdr-server-card').forEach(card => {
          const i = Number(card.dataset.serverIndex);
          const s = servers[i];
          if (!s) return;

          card.querySelectorAll('[data-f]').forEach(el => {
            const f = el.dataset.f;
            const handler = () => {
              if (el.type === 'checkbox') s[f] = el.checked;
              else if (f === 'qualityProfileId') s[f] = el.value ? Number(el.value) : null;
              else s[f] = el.value;
            };
            el.addEventListener('change', handler);
            el.addEventListener('input', handler);
          });

          card.querySelector('[data-act="reveal"]').addEventListener('click', (e) => {
            const inp = card.querySelector('[data-f="apiKey"]');
            const show = !inp.classList.contains('revealed');
            inp.classList.toggle('revealed', show);
            e.target.textContent = show ? 'Hide' : 'Show';
          });
          card.querySelector('[data-act="test"]').addEventListener('click', () => testAndPopulate(s, i));
          card.querySelector('[data-act="delete"]').addEventListener('click', () => onDeleteClick(i));

          const urlEl = card.querySelector('[data-f="url"]');
          const keyEl = card.querySelector('[data-f="apiKey"]');
          const maybeAuto = () => {
            if (urlEl.value.trim() && keyEl.value.trim() && (!s._profiles || !s._profiles.length)) testAndPopulate(s, i);
          };
          urlEl.addEventListener('blur', maybeAuto);
          keyEl.addEventListener('blur', maybeAuto);

          if (s._profiles && s._profiles.length) fillProfiles(s, i);
          if (s._rootFolders && s._rootFolders.length) fillRootFolders(s, i);
          if (s._live === true) setStatus(i, 'ok', `Connected — Radarr v${s._version || '?'}`);
          if (s._live === false) setStatus(i, 'bad', 'Last connection test failed.');
        });
      }

      function commitCurrentForm() {
        document.querySelectorAll(CFG + ' .rdr-server-card').forEach(card => {
          const s = servers[Number(card.dataset.serverIndex)];
          if (!s) return;
          card.querySelectorAll('[data-f]').forEach(el => {
            const f = el.dataset.f;
            if (el.type === 'checkbox') s[f] = el.checked;
            else if (f === 'qualityProfileId') s[f] = el.value ? Number(el.value) : null;
            else s[f] = el.value;
          });
        });
      }

      function serverCard(index) {
        return document.querySelector(CFG + ` .rdr-server-card[data-server-index="${index}"]`);
      }

      function setStatus(index, kind, html) {
        const card = serverCard(index);
        const el = card && card.querySelector('[data-el="status"]');
        if (!el) return;
        el.className = 'rdr-status show ' + kind;
        el.innerHTML = (kind === 'info' ? '<span class="rdr-spin"></span>' : '') + html;
      }

      function fillProfiles(s, index) {
        const card = serverCard(index);
        const sel = card && card.querySelector('[data-f="qualityProfileId"]');
        if (!sel) return;
        sel.innerHTML = '<option value="">— select —</option>' +
          s._profiles.map(p => `<option value="${p.id}" ${s.qualityProfileId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('');
      }
      function fillRootFolders(s, index) {
        const card = serverCard(index);
        const sel = card && card.querySelector('[data-f="rootFolderPath"]');
        if (!sel) return;
        sel.innerHTML = '<option value="">— select —</option>' +
          s._rootFolders.map(r => {
            const free = r.freeSpace ? ' (' + bytes(r.freeSpace) + ' free)' : '';
            return `<option value="${escapeAttr(r.path)}" ${s.rootFolderPath===r.path?'selected':''}>${escapeHtml(r.path)}${free}</option>`;
          }).join('');
      }

      async function testAndPopulate(s, index) {
        commitCurrentForm();
        if (!s.url || !s.url.trim()) { setStatus(index, 'bad', 'Enter a URL first.'); return; }
        if (!s.apiKey || !s.apiKey.trim()) { setStatus(index, 'bad', 'Enter an API key first.'); return; }
        setStatus(index, 'info', 'Testing connection…');
        try {
          const st = await RadarrAPI.status(s);
          s._live = true;
          s._version = st.data && st.data.version;
          if (!s.name) { s.name = (st.data && st.data.instanceName) || hostFrom(s.url); }
          // fetch profiles + root folders in parallel
          const [qp, rf] = await Promise.all([
            RadarrAPI.qualityProfiles(s).catch(() => ({ data: [] })),
            RadarrAPI.rootFolders(s).catch(() => ({ data: [] }))
          ]);
          s._profiles = qp.data || [];
          s._rootFolders = rf.data || [];

          fillProfiles(s, index); fillRootFolders(s, index);
          // default selections if none chosen
          if (!s.qualityProfileId && s._profiles[0]) { s.qualityProfileId = s._profiles[0].id; fillProfiles(s, index); }
          if (!s.rootFolderPath && s._rootFolders[0]) { s.rootFolderPath = s._rootFolders[0].path; fillRootFolders(s, index); }

          const card = serverCard(index);
          const nameField = card && card.querySelector('[data-f="name"]');
          if (nameField && !nameField.value) nameField.value = s.name;

          setStatus(index, 'ok', `Connected — Radarr v${s._version || '?'}. Loaded ${s._profiles.length} profile(s), ${s._rootFolders.length} root folder(s).`);
        } catch (err) {
          s._live = false;
          setStatus(index, 'bad', 'Failed: ' + escapeHtml(err.message || 'unknown error'));
        }
      }

      function onSaveClick() {
        commitCurrentForm();
        // drop entirely-empty servers
        const clean = servers.filter(s => (s.url && s.url.trim()) || (s.name && s.name.trim()));
        saveServers(clean);
        servers = loadServers();
        if (servers.length === 0) servers.push(blankServer());
        renderServerCards();
        setStatus(0, 'ok', 'Saved.');
        refreshConfigLink();
        renderEntries();
      }

      function onDeleteClick(index) {
        if (!servers[index]) return;
        const s = servers[index];
        if (!confirm('Delete server "' + (s.name || 'Server ' + (index + 1)) + '"?')) return;
        servers.splice(index, 1);
        if (servers.length === 0) servers.push(blankServer());
        saveServers(servers.filter(x => (x.url && x.url.trim())));
        renderServerCards();
        refreshConfigLink();
        renderEntries();
      }

      /* =========================================================================
       * Linkbar injection — the config link + per-server entries render inline as
       * native [bracketed] links inside PTP's div.linkbox (the row under the movie
       * header), matching [Edit description] [Bookmark] … etc.
       * =======================================================================*/
      function getLinkbar() {
        for (const sel of CONFIG.LINKBAR_SELECTORS) {
          let el;
          try { el = document.querySelector(sel); } catch (e) { el = null; }
          if (el) return el;
        }
        return null;
      }

      // A native-looking linkbox entry, e.g. "[Add to Home Radarr]".
      function mkLink(text, cls) {
        const a = document.createElement('a');
        a.className = CONFIG.LINK_CLASS + ' ' + cls;
        a.href = 'javascript:void(0)';
        a.textContent = '[' + text + ']';
        return a;
      }
      function sep() { return document.createTextNode(' '); }
      function setColor(el, c) { el.style.setProperty('color', c, 'important'); }

      function injectLinkbar() {
        if (document.getElementById('radarr-inline')) return true;
        const bar = getLinkbar();
        if (!bar) return false;
        // A single inline <span> holds all our links so re-rendering is trivial;
        // inline span keeps them flowing in the same row as the native links.
        bar.appendChild(sep());
        const span = document.createElement('span');
        span.id = 'radarr-inline';
        bar.appendChild(span);
        renderAll();
        return true;
      }

      // Build the URL of the user's own Edit-Preferences page, jumping to our tab.
      function settingsUrl() {
        let id = null;
        const link = document.querySelector('#nav_userinfo a[href*="user.php?id="], a.username[href*="user.php?id="], a[href*="user.php?id="]');
        if (link) id = (link.href.match(/[?&]id=(\d+)/) || [])[1] || null;
        return '/user.php?action=edit' + (id ? ('&userid=' + id) : '') + '#ptp-suite';
      }

      // Rebuild the inline group: one slim [Server Name] entry per configured server.
      function renderAll() {
        const span = document.getElementById('radarr-inline');
        if (!span) return;
        span.textContent = '';

        let list;
        try { list = loadServers().filter(s => s.url && s.url.trim() && s.apiKey && s.apiKey.trim()); }
        catch (e) { console.warn('[PTP-Radarr] renderAll load failed', e); return; }

        if (list.length === 0) {
          const a = mkLink('Radarr: set up', 'radarr-entry');
          setColor(a, '#8b95a5');
          a.href = settingsUrl();
          a.title = 'No Radarr server configured — open the PTP Suite settings';
          span.appendChild(a);
          return;
        }

        const info = movieInfo();
        list.forEach((s, i) => {
          if (i > 0) span.appendChild(sep());
          const name = s.name || hostFrom(s.url);
          const a = mkLink(name, 'radarr-entry');
          setColor(a, '#d0a24c');            // amber while checking
          a.title = 'Checking ' + name + '…';
          span.appendChild(a);
          resolveServerLine(s, info, a);
        });
      }

      // Kept as harmless aliases so boot / save callbacks read naturally.
      function refreshConfigLink() {}
      function renderEntries() { renderAll(); }

      // Resolve a single server's slim entry:
      //   green  = movie already in that library (click → view on Radarr)
      //   red    = movie missing (click → add-to-Radarr modal)
      //   grey   = server offline / unreachable (click → settings tab)
      //
      // Detection uses the SAME lookup the add flow uses (IMDb term first — PTP always
      // has an IMDb link, TMDb is often absent). Radarr's /movie/lookup sets the result's
      // `id` to a positive library id when the movie is already added; 0 means missing.
      // (The old code only checked by TMDb id, so pages without a TMDb link always went red.)
      async function resolveServerLine(s, info, a) {
        const name = s.name || hostFrom(s.url);
        a.textContent = '[' + name + ']';
        try {
          const term = info.imdbId ? ('imdb:' + info.imdbId)
                     : info.tmdbId ? ('tmdb:' + info.tmdbId)
                     : info.title;
          const lk = await RadarrAPI.lookup(s, term);
          const results = lk.data || [];
          const found =
            (info.imdbId && results.find(x => (x.imdbId || '').toLowerCase() === info.imdbId.toLowerCase())) ||
            (info.tmdbId && results.find(x => String(x.tmdbId) === String(info.tmdbId))) ||
            results[0] || null;

          // Primary signal: lookup marks in-library items with a positive `id`.
          let inLib = !!(found && found.id && found.id > 0);
          // Authoritative confirmation: local-DB query by the tmdbId we just resolved
          // (this is the same match Radarr uses to say "already added").
          const tmdbId = (found && found.tmdbId) || info.tmdbId || null;
          if (!inLib && tmdbId) {
            try { const r = await RadarrAPI.movieByTmdb(s, tmdbId); inLib = !!(r.data && r.data.length); } catch (e) {}
          }

          if (inLib) {
            setColor(a, '#4caf50');        // green — available
            a.href = normBase(s.url) + '/movie/' + encodeURIComponent(tmdbId || '');
            a.target = '_blank'; a.rel = 'noopener';
            a.title = name + ': in library — click to view on Radarr';
          } else {
            setColor(a, '#e05555');        // red — missing
            a.href = 'javascript:void(0)';
            a.title = name + ': not in library — click to add';
            a.addEventListener('click', (e) => { e.preventDefault(); openAddModal(s, info); });
          }
        } catch (err) {
          setColor(a, '#8b95a5');          // grey — offline
          a.href = settingsUrl();
          a.title = name + ' offline: ' + (err.message || 'unreachable');
        }
      }

      /* =========================================================================
       * Utils
       * =======================================================================*/
      function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
      function escapeAttr(s){ return escapeHtml(s); }
      function hostFrom(u){ try { return new URL(normBase(u)).host; } catch(e){ return 'Radarr'; } }
      function bytes(n){ if(!n) return '0 B'; const u=['B','KB','MB','GB','TB','PB']; let i=0; while(n>=1024&&i<u.length-1){n/=1024;i++;} return n.toFixed(1)+' '+u[i]; }

      /* =========================================================================
       * Add-to-Radarr confirm modal
       * =======================================================================*/
      let addState = null;

      function buildAddSkeleton() {
        if (document.getElementById('radarr-add-ov')) return;
        const ov = document.createElement('div');
        ov.id = 'radarr-add-ov';
        ov.innerHTML = `
          <div id="radarr-modal" style="width:560px;">
            <div class="rdr-addhead">
              <img data-el="poster" alt="">
              <div class="meta">
                <h3 data-el="title">…</h3>
                <div class="sub" data-el="sub"></div>
                <div class="srv" data-el="srv"></div>
              </div>
            </div>
            <div class="rdr-body">
              <div class="rdr-status" data-el="status"></div>
              <div class="rdr-row">
                <div class="rdr-field"><label>Quality Profile</label><select data-f="qualityProfileId"></select></div>
                <div class="rdr-field"><label>Root Folder</label><select data-f="rootFolderPath"></select></div>
              </div>
              <div class="rdr-row">
                <div class="rdr-field"><label>Minimum Availability</label><select data-f="minimumAvailability">
                  ${MIN_AVAIL.map(v=>`<option value="${v}">${v}</option>`).join('')}
                </select></div>
                <div class="rdr-field"></div>
              </div>
              <div class="rdr-field"><label class="rdr-toggle"><input type="checkbox" data-f="monitored"> Monitored</label></div>
              <div class="rdr-field"><label class="rdr-toggle"><input type="checkbox" data-f="searchOnAdd"> Search for movie on add</label></div>
            </div>
            <div class="rdr-foot">
              <button class="rdr-btn" data-act="cancel">Cancel</button>
              <div class="right"><button class="rdr-btn good" data-act="add">Add to Radarr</button></div>
            </div>
          </div>`;
        document.body.appendChild(ov);
        ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('open'); });
        ov.querySelector('[data-act="cancel"]').addEventListener('click', () => ov.classList.remove('open'));
      }

      async function openAddModal(server, info) {
        buildAddSkeleton();
        const ov = document.getElementById('radarr-add-ov');
        ov.classList.add('open');
        const q = (sel) => ov.querySelector(sel);
        const setStat = (k, h) => { const el = q('[data-el="status"]'); el.className = 'rdr-status show ' + k; el.innerHTML = (k === 'info' ? '<span class="rdr-spin"></span>' : '') + h; };
        const hideStat = () => { q('[data-el="status"]').className = 'rdr-status'; };

        q('[data-el="srv"]').textContent = 'Server: ' + (server.name || hostFrom(server.url));
        q('[data-el="title"]').textContent = info.title || 'Resolving…';
        q('[data-el="sub"]').textContent = '';
        q('[data-el="poster"]').src = '';
        const addBtn = q('[data-act="add"]'); addBtn.disabled = true;
        setStat('info', 'Resolving movie & loading options…');

        try {
          // Prefer IMDb (PTP always has it), then TMDb, then title.
          const term = info.imdbId ? ('imdb:' + info.imdbId)
                     : info.tmdbId ? ('tmdb:' + info.tmdbId)
                     : info.title;
          const [qp, rf, lk] = await Promise.all([
            RadarrAPI.qualityProfiles(server),
            RadarrAPI.rootFolders(server),
            RadarrAPI.lookup(server, term)
          ]);
          const profiles = qp.data || [], roots = rf.data || [];
          const results = lk.data || [];
          const found =
            (info.imdbId && results.find(x => (x.imdbId || '').toLowerCase() === info.imdbId.toLowerCase())) ||
            (info.tmdbId && results.find(x => String(x.tmdbId) === String(info.tmdbId))) ||
            results[0];
          if (!found) { setStat('bad', 'Could not find this movie in Radarr’s lookup.'); return; }
          addState = { server, lookup: found };

          q('[data-el="title"]').textContent = (found.title || info.title) + (found.year ? (' (' + found.year + ')') : '');
          q('[data-el="sub"]').textContent = [found.studio, found.status,
            (found.runtime ? found.runtime + ' min' : '')].filter(Boolean).join(' · ');
          const poster = (found.images || []).find(i => i.coverType === 'poster');
          if (poster) q('[data-el="poster"]').src = poster.remoteUrl || poster.url;

          q('[data-f="qualityProfileId"]').innerHTML = profiles.map(p =>
            `<option value="${p.id}" ${server.qualityProfileId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('');
          q('[data-f="rootFolderPath"]').innerHTML = roots.map(r =>
            `<option value="${escapeAttr(r.path)}" ${server.rootFolderPath===r.path?'selected':''}>${escapeHtml(r.path)}${r.freeSpace?(' ('+bytes(r.freeSpace)+' free)'):''}</option>`).join('');
          q('[data-f="minimumAvailability"]').value = server.minimumAvailability || 'released';
          q('[data-f="monitored"]').checked = server.monitored !== false;
          q('[data-f="searchOnAdd"]').checked = server.searchOnAdd !== false;

          hideStat();
          addBtn.disabled = false;
          addBtn.onclick = () => doAdd(ov, q, setStat, addBtn);
        } catch (err) {
          setStat('bad', 'Error: ' + escapeHtml(err.message || 'unknown'));
        }
      }

      async function doAdd(ov, q, setStat, addBtn) {
        if (!addState) return;
        const { server, lookup } = addState;
        const qpId = Number(q('[data-f="qualityProfileId"]').value) || null;
        const rootPath = q('[data-f="rootFolderPath"]').value;
        const minAvail = q('[data-f="minimumAvailability"]').value || 'released';
        const monitored = q('[data-f="monitored"]').checked;
        const searchOnAdd = q('[data-f="searchOnAdd"]').checked;
        if (!qpId) { setStat('bad', 'Pick a quality profile.'); return; }
        if (!rootPath) { setStat('bad', 'Pick a root folder.'); return; }

        const payload = Object.assign({}, lookup, {
          qualityProfileId: qpId,
          rootFolderPath: rootPath,
          monitored: monitored,
          minimumAvailability: minAvail,
          addOptions: { searchForMovie: searchOnAdd, monitor: monitored ? 'movieOnly' : 'none' }
        });

        addBtn.disabled = true;
        setStat('info', 'Adding to ' + (server.name || 'Radarr') + '…');
        try {
          await RadarrAPI.addMovie(server, payload);
          setStat('ok', 'Added! ' + (searchOnAdd ? 'Radarr is searching for a release.' : 'Monitoring set.'));
          setTimeout(() => { ov.classList.remove('open'); renderEntries(); }, 1300);
        } catch (err) {
          addBtn.disabled = false;
          setStat('bad', 'Add failed: ' + escapeHtml(err.message || 'unknown'));
        }
      }

      /* =========================================================================
       * Boot
       * =======================================================================*/
      let booted = false;
      function attemptInject() {
        if (booted) return true;
        try {
          injectStyle();
          // Route by page: movie page → linkbar entries; settings page → PTP Suite tab.
          const ok = IS_MOVIE_PAGE ? injectLinkbar() : injectSettingsTab();
          if (ok) booted = true;
        } catch (e) {
          console.warn('[PTP-Radarr] inject attempt failed', e);
        }
        return booted;
      }

      function boot() {
        console.log('%c[PTP-Radarr] loaded', 'color:#4caf50;font-weight:bold', location.href);
        if (attemptInject()) return;
        // linkbar / settings tabs can render slightly late — retry on a bounded timer only.
        let tries = 0;
        const iv = setInterval(() => {
          try { if (attemptInject() || ++tries > 25) clearInterval(iv); }
          catch (e) { clearInterval(iv); console.warn('[PTP-Radarr] boot retry failed', e); }
        }, 400);
      }

      // expose movie info for the add flow
      window.__ptpMovie = movieInfo();

      (async () => {
        try { await initStorage(); }
        catch (e) { console.error('[PTP-Radarr] storage init error', e); }
        try { boot(); }
        catch (e) { console.error('[PTP-Radarr] boot error', e); }
      })();
    })();
    }

    /* ================================================================== *
     *  PTP fanart.tv Clearlogo Panel v1.0.0  --  torrents.php
     * ================================================================== */
    function MOD_clearlogo() {
    (function () {
        'use strict';

        /* ------------------------------------------------------------------ *
         * CONFIG
         * ------------------------------------------------------------------ */
        const API_KEY = FANART_TV_API_KEY;

        // Prefer English logos; if none found, fall back to any language.
        const PREFERRED_LANG = 'en';

        /* ------------------------------------------------------------------ *
         * 1. Find the "Cover" panel so we can clone its styling & sit above it
         * ------------------------------------------------------------------ */
        function findCoverHeading() {
            const candidates = document.querySelectorAll(
                'h1,h2,h3,h4,h5,legend,[class*="head"],[class*="title"],[class*="Head"],[class*="Title"]'
            );
            for (const el of candidates) {
                if (el.children.length === 0 &&
                    el.textContent.trim().toLowerCase() === 'cover') {
                    return el;
                }
            }
            return null;
        }

        // Climb up from the heading until we reach the container that also holds
        // the poster <img> — that container is the whole "Cover" panel.
        function panelFromHeading(heading) {
            let node = heading;
            while (node.parentElement) {
                node = node.parentElement;
                if (node.querySelector('img')) return node;
                if (node.tagName === 'BODY') break;
            }
            return heading.parentElement; // fallback
        }

        /* ------------------------------------------------------------------ *
         * 2. Work out the movie's IMDb id from the page
         * ------------------------------------------------------------------ */
        function getMovieId() {
            const link = document.querySelector('a[href*="imdb.com/title/tt"]');
            if (link) {
                const m = link.href.match(/tt\d+/);
                if (m) return m[0];
            }
            const m2 = document.documentElement.innerHTML.match(/tt\d{6,10}/);
            return m2 ? m2[0] : null;
        }

        /* ------------------------------------------------------------------ *
         * 3. Fetch fanart.tv and pick the best clearlogo
         * ------------------------------------------------------------------ */
        function fetchLogo(movieId, cb) {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://webservice.fanart.tv/v3/movies/${movieId}?api_key=${API_KEY}`,
                onload(res) {
                    if (res.status !== 200) {
                        cb(new Error('fanart.tv returned HTTP ' + res.status), null);
                        return;
                    }
                    let data;
                    try { data = JSON.parse(res.responseText); }
                    catch (e) { cb(e, null); return; }
                    cb(null, pickLogo(data));
                },
                onerror() { cb(new Error('Network error contacting fanart.tv'), null); }
            });
        }

        function pickLogo(data) {
            const hd = data.hdmovielogo || [];
            const sd = data.movielogo || [];
            const byLikes = (a, b) => (parseInt(b.likes, 10) || 0) - (parseInt(a.likes, 10) || 0);
            const isEn = i => (i.lang || '').toLowerCase() === PREFERRED_LANG;

            const hdEn = hd.filter(isEn).sort(byLikes);
            const sdEn = sd.filter(isEn).sort(byLikes);
            const hdAny = hd.slice().sort(byLikes);
            const sdAny = sd.slice().sort(byLikes);

            // Preferably HD, English only; fall back gracefully.
            const best = hdEn[0] || sdEn[0] || hdAny[0] || sdAny[0];
            return best ? best.url : null;
        }

        /* ------------------------------------------------------------------ *
         * 4. Build & insert the Clearlogo panel (clone of the Cover panel)
         * ------------------------------------------------------------------ */
        function buildPanel(coverPanel) {
            const clone = coverPanel.cloneNode(true);

            // Strip ids to avoid duplicates on the page.
            if (clone.id) clone.removeAttribute('id');
            clone.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));

            // Rename the heading "Cover" -> "Clearlogo".
            const h = [...clone.querySelectorAll('*')].find(
                e => e.children.length === 0 && e.textContent.trim().toLowerCase() === 'cover'
            );
            if (h) h.textContent = 'Clearlogo';

            // The body region is whatever holds the poster image in the clone.
            const cloneImg = clone.querySelector('img');
            const body = cloneImg ? cloneImg.parentElement : clone;
            body.innerHTML = '<div data-clearlogo-body style="padding:12px;text-align:center;">' +
                             '<span style="opacity:.6;font-size:13px;">Loading clearlogo…</span></div>';

            coverPanel.parentElement.insertBefore(clone, coverPanel);
            return clone.querySelector('[data-clearlogo-body]');
        }

        function renderLogo(bodyEl, url) {
            bodyEl.innerHTML = '';
            const img = document.createElement('img');
            img.src = url;
            img.alt = 'Clearlogo';
            img.referrerPolicy = 'no-referrer';
            img.style.cssText = 'max-width:100%;height:auto;display:block;margin:0 auto;';
            bodyEl.appendChild(img);
        }

        function renderMessage(bodyEl, msg) {
            bodyEl.innerHTML =
                '<span style="opacity:.6;font-size:13px;">' + msg + '</span>';
        }

        /* ------------------------------------------------------------------ *
         * 5. Go
         * ------------------------------------------------------------------ */
        const heading = findCoverHeading();
        if (!heading) return; // not a movie page with a Cover panel

        const coverPanel = panelFromHeading(heading);
        const bodyEl = buildPanel(coverPanel);

        if (!API_KEY || API_KEY === 'PUT_YOUR_FANART_TV_API_KEY_HERE') {
            renderMessage(bodyEl, 'Set your fanart.tv API key in the script.');
            return;
        }

        const movieId = getMovieId();
        if (!movieId) {
            renderMessage(bodyEl, 'Could not find an IMDb id on this page.');
            return;
        }

        fetchLogo(movieId, (err, url) => {
            if (err) { renderMessage(bodyEl, err.message); return; }
            if (!url) { renderMessage(bodyEl, 'No clearlogo found on fanart.tv.'); return; }
            renderLogo(bodyEl, url);
        });
    })();
    }

    /* ================================================================== *
     *  PTP - Collapse Torrent Categories v1.0  --  torrents.php?id=*
     * ================================================================== */
    function MOD_collapseCategories() {
    (function () {
      'use strict';

      const isEdition = (r) =>
        r.classList.contains('group_torrent') &&
        !r.classList.contains('group_torrent_header');

      function addStyle() {
        if (document.getElementById('ptp-collapse-style')) return;
        const st = document.createElement('style');
        st.id = 'ptp-collapse-style';
        st.textContent = `
          .ptp-collapsed { display: none !important; }
          .ptp-collapse-toggle {
            float: right;
            font-size: 11px;
            font-weight: normal;
            cursor: pointer;
            opacity: .55;
            user-select: none;
            margin-left: 8px;
          }
          .ptp-collapse-toggle:hover { opacity: 1; text-decoration: underline; }
        `;
        document.head.appendChild(st);
      }

      function init() {
        const table = document.querySelector('table.torrent_table');
        if (!table) return;

        addStyle();

        const rows = [...table.querySelectorAll('tr')];
        const editions = rows.filter(isEdition);

        editions.forEach((ed) => {
          const cell = ed.cells[0];
          if (!cell || cell.querySelector('.ptp-collapse-toggle')) return; // already done

          const name = ed.textContent.replace(/\s+/g, ' ').trim();
          const key = 'ptpCollapse:' + name;

          // all rows belonging to this category (until the next edition header)
          const kids = [];
          for (let n = ed.nextElementSibling; n && !isEdition(n); n = n.nextElementSibling) {
            kids.push(n);
          }

          const toggle = document.createElement('span');
          toggle.className = 'ptp-collapse-toggle';

          const apply = (collapsed) => {
            kids.forEach((k) => k.classList.toggle('ptp-collapsed', collapsed));
            toggle.textContent = collapsed ? '[ show ]' : '[ hide ]';
          };

          toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const collapsed = !kids[0] || !kids[0].classList.contains('ptp-collapsed');
            try { localStorage.setItem(key, collapsed ? '1' : '0'); } catch (_) {}
            apply(collapsed);
          });

          cell.appendChild(toggle);

          // restore saved state
          let saved = '0';
          try { saved = localStorage.getItem(key) || '0'; } catch (_) {}
          apply(saved === '1');
        });
      }

      init();
    })();
    }

    /* ================================================================== *
     *  PTP Daily Top 10 Posters v1.4.0  --  homepage
     * ================================================================== */
    function MOD_dailyTop10() {
    (function () {
      'use strict';

      // ------------------------------------------------------------------
      // CONFIG
      // ------------------------------------------------------------------
      // Paste your TMDB API key here (v3 auth "API Key", the short one — NOT the
      // long v4 read-access token). Get one at https://www.themoviedb.org/settings/api
      // If left blank, the strip still works using PTP's own cover art.
      // The TMDB key is NOT stored in this file. Set it once via the Tampermonkey
      // menu -> "Set TMDB API key" (shared with the TMDB Enricher module).
      const TMDB_API_KEY = PTPSuite.tmdbKey();

      const CACHE_TTL_MS   = 60 * 60 * 1000;              // 1 hour — list reuse window
      const POSTER_TTL_MS  = 14 * 24 * 60 * 60 * 1000;    // posters: keep 2 weeks
      const POSTER_WIDTH   = 'w154';   // TMDB size: w92 / w154 / w185 / w342
      const DISPLAY_WIDTH  = 92;       // rendered px width of each poster
      const MAX_ITEMS      = 10;
      const PERIOD_INDEX   = 1;        // coverViewJsonData index: 0=Day 1=Week 2=Month 3=Year
      const PERIOD_LABEL   = 'Weekly Top 10';

      const LIST_CACHE_KEY   = 'ptp_top10_list_p' + PERIOD_INDEX; // per-period cache
      const POSTER_CACHE_KEY = 'ptp_poster_map';                  // { [imdbId]: {path, ts} }

      // ------------------------------------------------------------------
      // STYLES
      // ------------------------------------------------------------------
      GM_addStyle(`
        /* Frameless, to match the TMDB "On This Day" / "New Uploads" panels below */
        #ptp-top10-strip { margin: 0 0 14px 0; padding: 2px 0 0; }
        #ptp-top10-strip .ptp-t10-title {
          font-weight: 700; font-size: 12px; color: #e8edf6;
          margin: 0 0 9px 0; letter-spacing: normal; text-transform: none;
          writing-mode: horizontal-tb; transform: none;
        }
        #ptp-top10-strip .ptp-t10-row {
          display: flex; gap: 10px; align-items: flex-start;
          justify-content: space-between; width: 100%;
        }
        #ptp-top10-strip a.ptp-t10-item {
          flex: 1 1 0; min-width: 0; position: relative;
          max-width: ${DISPLAY_WIDTH + 45}px;
          text-decoration: none; display: block;
        }
        #ptp-top10-strip a.ptp-t10-item img {
          width: 100%; aspect-ratio: 2 / 3;
          object-fit: cover; border-radius: 6px; display: block; background: #182430;
          box-shadow: 0 1px 6px rgba(0,0,0,.5);
        }
        /* Rank pill styled like the panels' year badge */
        #ptp-top10-strip a.ptp-t10-item .ptp-rank {
          position: absolute; top: 6px; left: 6px;
          background: rgba(1,180,228,.92); color: #04121a;
          font-weight: 800; font-size: 11px; line-height: normal;
          padding: 1px 7px; border-radius: 10px;
          box-shadow: 0 1px 3px rgba(0,0,0,.5);
        }
        #ptp-top10-strip a.ptp-t10-item .ptp-cap {
          font-size: 12px; font-weight: 700; line-height: 1.25; margin-top: 6px;
          color: #e8edf6; max-height: 30px; overflow: hidden;
        }
        #ptp-top10-strip a.ptp-t10-item:hover .ptp-cap { color: #fff; }
        #ptp-top10-strip .ptp-noposter {
          width: 100%; aspect-ratio: 2 / 3;
          display: flex; align-items: center; justify-content: center; text-align: center;
          font-size: 11px; color: #99a; background: #182430; border-radius: 6px;
          padding: 4px; box-sizing: border-box;
        }
      `);

      // ------------------------------------------------------------------
      // HELPERS
      // ------------------------------------------------------------------
      function gmGetJSON(key, fallback) {
        try { const v = GM_getValue(key); return v ? JSON.parse(v) : fallback; }
        catch (e) { return fallback; }
      }
      function gmSetJSON(key, val) { GM_setValue(key, JSON.stringify(val)); }

      function gmFetch(url) {
        return new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: 'GET', url,
            onload: (r) => (r.status >= 200 && r.status < 300)
              ? resolve(r) : reject(new Error('HTTP ' + r.status)),
            onerror: () => reject(new Error('Network error')),
            ontimeout: () => reject(new Error('Timeout')),
          });
        });
      }

      // ------------------------------------------------------------------
      // PARSE top10.php?type=movies
      // ------------------------------------------------------------------
      // The movie rows are NOT in the HTML tables (those are rendered client-side).
      // The real data sits in an inline script as:
      //   coverViewJsonData[ 0 ] = {"Movies":[{GroupId,Title,Year,Cover,ImdbId,...}]}
      // Index 0 = past Day, 1 = Week, 2 = Month, 3 = Year.
      function extractCoverViewData(html, index) {
        const marker = new RegExp('coverViewJsonData\\[\\s*' + index + '\\s*\\]\\s*=\\s*');
        const m = marker.exec(html);
        if (!m) return null;
        let i = html.indexOf('{', m.index + m[0].length);
        if (i < 0) return null;
        // string-aware brace matching to grab the exact JSON object
        let depth = 0, end = -1, inStr = false, esc = false;
        for (let j = i; j < html.length; j++) {
          const ch = html[j];
          if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
          } else if (ch === '"') inStr = true;
          else if (ch === '{') depth++;
          else if (ch === '}') { depth--; if (depth === 0) { end = j; break; } }
        }
        if (end < 0) return null;
        try { return JSON.parse(html.slice(i, end + 1)); }
        catch (e) { return null; }
      }

      function parseDayMovies(html) {
        const data = extractCoverViewData(html, PERIOD_INDEX);
        const movies = (data && data.Movies) || [];
        return movies.slice(0, MAX_ITEMS).map(mv => ({
          groupId: String(mv.GroupId || ''),
          title: mv.Title || '',
          year: mv.Year ? String(mv.Year) : '',
          // PTP gives ImdbId without the "tt" prefix (e.g. "0076759")
          imdbId: mv.ImdbId ? ('tt' + String(mv.ImdbId).replace(/^tt/, '')) : '',
          cover: mv.Cover || '',   // PTP-hosted poster, used as fallback
          groupUrl: 'https://passthepopcorn.me/torrents.php?id=' + mv.GroupId,
        })).filter(x => x.groupId && x.title);
      }

      // ------------------------------------------------------------------
      // TMDB poster via exact IMDb-ID match, cached per imdbId
      // ------------------------------------------------------------------
      async function resolvePoster(item, posterMap) {
        // No key or no imdb id -> just use PTP cover.
        const haveKey = TMDB_API_KEY && TMDB_API_KEY !== 'YOUR_KEY_HERE';
        if (!haveKey || !item.imdbId) return item.cover || null;

        const cached = posterMap[item.imdbId];
        if (cached && (Date.now() - cached.ts) < POSTER_TTL_MS) {
          return cached.path
            ? 'https://image.tmdb.org/t/p/' + POSTER_WIDTH + cached.path
            : (item.cover || null);
        }

        let path = null;
        try {
          const url = 'https://api.themoviedb.org/3/find/' + encodeURIComponent(item.imdbId) +
            '?external_source=imdb_id&api_key=' + encodeURIComponent(TMDB_API_KEY);
          const r = await gmFetch(url);
          const data = JSON.parse(r.responseText);
          const hit = (data.movie_results && data.movie_results[0]) ||
                      (data.tv_results && data.tv_results[0]);
          path = (hit && hit.poster_path) || null;
        } catch (e) {
          console.warn('[PTP Top10] TMDB lookup failed for', item.title, e);
          return item.cover || null; // transient — don't cache, fall back to PTP cover
        }

        posterMap[item.imdbId] = { path, ts: Date.now() };
        return path
          ? 'https://image.tmdb.org/t/p/' + POSTER_WIDTH + path
          : (item.cover || null);
      }

      // ------------------------------------------------------------------
      // RENDER
      // ------------------------------------------------------------------
      function render(items) {
        if (!items || !items.length) return;
        const old = document.getElementById('ptp-top10-strip');
        if (old) old.remove();

        const strip = document.createElement('div');
        strip.id = 'ptp-top10-strip';

        const label = document.createElement('div');
        label.className = 'ptp-t10-title';
        label.textContent = '🏆 ' + PERIOD_LABEL; // 🏆 to match panel headings
        strip.appendChild(label);

        const row = document.createElement('div');
        row.className = 'ptp-t10-row';
        strip.appendChild(row);

        items.forEach((it, i) => {
          const a = document.createElement('a');
          a.className = 'ptp-t10-item';
          a.href = it.groupUrl;
          a.title = it.title + (it.year ? ' (' + it.year + ')' : '');

          const rank = document.createElement('span');
          rank.className = 'ptp-rank';
          rank.textContent = (i + 1);
          a.appendChild(rank);

          if (it.posterUrl) {
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.src = it.posterUrl;
            img.alt = it.title;
            a.appendChild(img);
          } else {
            const ph = document.createElement('div');
            ph.className = 'ptp-noposter';
            ph.textContent = it.title + (it.year ? ' (' + it.year + ')' : '');
            a.appendChild(ph);
          }

          const cap = document.createElement('div');
          cap.className = 'ptp-cap';
          cap.textContent = it.title;
          a.appendChild(cap);

          row.appendChild(a);
        });

        // Place it below the "Latest Forum Posts" widget, inside the LEFT main column
        // (so it takes the main-column width, not the right sidebar width).
        let placed = false;
        const mainCol = document.querySelector('.main-column');
        if (mainCol) {
          const tabLink = [...mainCol.querySelectorAll('a, span')]
            .find(e => /^\s*Latest Forum Posts\s*$/i.test(e.textContent));
          let target = tabLink ? tabLink.closest('table') : null;
          if (target) {
            // step past sibling tab tables (e.g. the hidden "Latest Torrent Comments")
            while (target.nextElementSibling &&
                   target.nextElementSibling.matches &&
                   target.nextElementSibling.matches('table.table--panel-like')) {
              target = target.nextElementSibling;
            }
            target.parentNode.insertBefore(strip, target.nextSibling);
            placed = true;
          }
          if (!placed) { mainCol.insertBefore(strip, mainCol.firstChild); placed = true; }
        }
        if (!placed) {
          const anchor = document.querySelector('#content .thin') ||
                         document.querySelector('#content') || document.body;
          anchor.insertBefore(strip, anchor.firstChild);
        }
      }

      // ------------------------------------------------------------------
      // MAIN
      // ------------------------------------------------------------------
      async function main() {
        // 1) Fresh cache -> render instantly, zero network.
        const listCache = gmGetJSON(LIST_CACHE_KEY, null);
        if (listCache && (Date.now() - listCache.ts) < CACHE_TTL_MS && listCache.items.length) {
          render(listCache.items);
          return;
        }

        // 2) Stale/empty -> fetch top10 movies once, parse the Day JSON, resolve posters.
        let items;
        try {
          const r = await gmFetch('https://passthepopcorn.me/top10.php?type=movies');
          items = parseDayMovies(r.responseText);
        } catch (e) {
          console.warn('[PTP Top10] failed to fetch top10.php', e);
          if (listCache && listCache.items.length) render(listCache.items);
          return;
        }
        if (!items.length) {
          console.warn('[PTP Top10] parsed 0 movies — coverViewJsonData layout may have changed.');
          return;
        }

        const posterMap = gmGetJSON(POSTER_CACHE_KEY, {});
        for (const it of items) {
          it.posterUrl = await resolvePoster(it, posterMap);
        }
        gmSetJSON(POSTER_CACHE_KEY, posterMap);
        gmSetJSON(LIST_CACHE_KEY, { ts: Date.now(), items });

        render(items);
      }

      main();
    })();
    }

    /* ================================================================== *
     *  DISPATCH                                                          *
     * ================================================================== */
    registerMenu();

    // Runs at document-start so the Top 10 grid never flashes at the wrong size.
    if (PAGE.top10 && PTPSuite.featureEnabled('top10SingleRow')) runModule('Top 10 Single Row', MOD_top10SingleRow);

    onReady(() => {
        const latestDigitalActive = PTPSuite.latestDigitalEnabled() && isLatestDigitalRoute();

        if (PTPSuite.featureEnabled('iconUserBar')) runModule('Icon User Bar', MOD_iconUserBar);
        if (PTPSuite.latestDigitalEnabled()) runModule('Latest Digital', MOD_latestDigital);

        if (PTPSuite.featureEnabled('tmdbEnricher') && PAGE.torrents) runModule('TMDB Enricher', MOD_tmdbEnricher);
        else if (PTPSuite.featureEnabled('tmdbEnricher') && PAGE.home && !latestDigitalActive) runModule('TMDB Enricher', MOD_tmdbEnricher);
        if (PAGE.artist && PTPSuite.featureEnabled('tmdbPeople')) runModule('TMDB People', MOD_tmdbPeople);

        if (PAGE.torrents) {
            if (PTPSuite.featureEnabled('parentsGuide')) runModule('Parents Guide', MOD_parentsGuide);
            if (PTPSuite.featureEnabled('trailerModal')) runModule('Trailer Modal', MOD_trailerModal);
            if (PTPSuite.featureEnabled('clearlogo')) runModule('Clearlogo Panel', MOD_clearlogo);
        }
        if (PAGE.user || (PAGE.torrents && PTPSuite.featureEnabled('radarr'))) runModule('Radarr', MOD_radarr);
        if (PAGE.movie && PTPSuite.featureEnabled('collapseCategories')) runModule('Collapse Categories', MOD_collapseCategories);
        if (PAGE.home && !latestDigitalActive && PTPSuite.featureEnabled('dailyTop10')) runModule('Daily Top 10 Posters', MOD_dailyTop10);
    });
})();
