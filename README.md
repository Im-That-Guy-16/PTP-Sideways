<p align="center">
  <img src="assets/header.png" alt="PTP Sideways" width="100%">
</p>

<h1 align="center">PTP Sideways</h1>

<p align="center"><em>A widescreen dark theme paired with an all-in-one companion userscript.</em></p>

<p align="center">
  <img alt="Type" src="https://img.shields.io/badge/Type-Theme%20%2B%20Userscript-0F172A?style=for-the-badge">
  <img alt="Version" src="https://img.shields.io/badge/Version-1.1.11-38BDF8?style=for-the-badge">
  <img alt="CSS" src="https://img.shields.io/badge/CSS-Dark%20Widescreen-1572B6?style=for-the-badge&logo=css3&logoColor=white">
  <img alt="Userscript" src="https://img.shields.io/badge/Userscript-All--In--One-2563EB?style=for-the-badge">
  <img alt="Tampermonkey" src="https://img.shields.io/badge/Tampermonkey-Ready-00485B?style=for-the-badge&logo=tampermonkey&logoColor=white">
  <img alt="Licence" src="https://img.shields.io/badge/Licence-MIT-22C55E?style=for-the-badge">
</p>

---

## Overview

PTP Sideways is a paired stylesheet and userscript bundle. The CSS provides the
widescreen dark restyle; the userscript merges every companion script into a single
install, with each module gated to the pages its standalone version matched and
isolated so one failure cannot take down the rest.

| File | Role |
|---|---|
| `PassThatPopcorn.css` | Widescreen dark restyle |
| `PTP Suite.user.js` | All companion modules in one install |

## Features

- **TMDb enricher** — richer detail pages with hero art and extended metadata.
- **TMDb people** — cast and crew cards.
- **Latest digital** — recent digital release surfacing.
- **IMDb Parents Guide** via GraphQL, with colour-coded categories.
- **Radarr integration** with multi-server status and one-click add.
- **Fanart.tv ClearLogo** panel.
- **Trailer modal** with a clean embedded player.
- **Collapsible categories** on detail pages.
- **Homepage Top 10** poster strip, plus a single-row poster layout.

## Install

### 1. Stylesheet

Load `PassThatPopcorn.css` through your profile's stylesheet setting, or in a
userstyle manager such as [Stylus](https://add0n.com/stylus.html).

### 2. Userscript

Install with [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/):

```text
https://gitlab.com/Prism_16/PTP-Sideways/-/raw/main/PTP%20Suite.user.js?inline=false
```

> Disable any older standalone scripts that duplicate these modules first, or you
> will get duplicate panels.

### 3. API keys

The script stores your own keys in userscript-manager storage via the manager menu.
TMDb powers the enricher and people modules; Fanart.tv powers the logo panel; Radarr
needs your server URL and key. Modules without a configured key skip themselves.

No keys are stored in this repository.

## Licence

Released under the [MIT Licence](LICENSE).
