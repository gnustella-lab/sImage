# sImage

A static image studio focused on privacy. Every operation runs in the browser, with no uploads, accounts, cookies, or analytics.

## Features

- metadata removal by re-encoding image pixels;
- local detection of known EXIF/GPS, XMP, IPTC, comment, PNG, and WebP metadata blocks;
- pixelation, blur, and solid covers for selected areas;
- resizing with optional aspect ratio preservation;
- JPEG and WebP compression;
- conversion between JPEG, PNG, and WebP;
- anonymous filenames generated with `crypto.getRandomValues`;
- output verification before download;
- offline app shell caching with a Service Worker;
- responsive and accessible interface.

## Run locally

Use a simple HTTP server because Service Workers do not run on `file://` URLs:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## Publish to GitHub Pages

This project includes `.github/workflows/deploy-pages.yml`.

1. Create a public GitHub repository named `sImage`.
2. Push these files to the `main` branch.
3. Open `Settings > Pages` in GitHub.
4. Under `Build and deployment`, select `GitHub Actions`.
5. The workflow will publish the site automatically after every push to `main`.

With GitHub CLI:

```bash
git init
git add .
git commit -m "feat: create sImage"
git branch -M main
gh repo create sImage --public --source=. --remote=origin --push
```

If GitHub does not enable Pages automatically, select `GitHub Actions` in the repository Pages settings.

## Privacy and limitations

The browser decodes the source file and exports a fresh image through the Canvas API. This process discards metadata blocks supported by the output format. sImage also scans the generated copy before starting the download.

- Animated GIFs are exported as a static image.
- Color profiles may change slightly during re-encoding.
- Very large images depend on browser memory and Canvas limits.
- The tool does not detect faces or text automatically. The user manually selects areas to hide.

## Project structure

```text
index.html                 interface and content
styles.css                 visual design and responsive layout
app.js                     local image processing
sw.js                      offline app shell cache
manifest.webmanifest       installable app metadata
favicon.svg                vector icon
.github/workflows/         GitHub Pages deployment
```

## License

Free for personal and commercial use. Add an explicit license before accepting external contributions.
