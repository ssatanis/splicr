# SplicR - CRISPR Screen Analysis Platform

SplicR is a powerful web-based and desktop application for analyzing CRISPR screening data. Built with Next.js, Supabase, and Electron, it provides researchers with an intuitive interface for analyzing, visualizing, and sharing their CRISPR screen results.

## Available Platforms

### Web Version (Current)
Access SplicR online at [splicr.org](https://splicr.org)

- ✅ No installation required
- ✅ Access from any device with a browser
- ✅ Always up-to-date with the latest features
- ✅ Cloud-based data storage and collaboration

### Desktop App (Distribution Ready)
SplicR is available as a downloadable desktop application for Mac, Windows, and Linux. The desktop app provides the same functionality as the web version and connects to the same Supabase backend.

**Download:**
- [Download for Mac](https://splicr.org/downloads/SplicR.dmg)
- [Download for Windows](https://splicr.org/downloads/SplicR.exe)
- [Download for Linux](https://splicr.org/downloads/SplicR.AppImage)

Or build from source (see “Building Desktop Distributables” below):

- 🍎 **macOS**: SplicR-1.0.0.dmg
- 🪟 **Windows**: SplicR Setup 1.0.0.exe
- 🐧 **Linux**: SplicR-1.0.0.AppImage

#### Desktop App Features:
- Same functionality as the web version
- Native operating system integration
- Rounded corners and modern UI (macOS)
- Secure and sandboxed
- Connects to Supabase for data sync
- Will not be flagged as malware (properly code-signed)

## For Developers

### Running the Web Version

```bash
# Development mode
npm run dev

# Production build
npm run build
npm run start
```

The web app will be available at `http://localhost:3000`.

### Building Desktop Distributables

To create native desktop applications:

```bash
# Build for all platforms (Mac, Windows, Linux)
npm run build:electron

# Build for specific platforms
npm run build:electron:mac     # macOS (.dmg)
npm run build:electron:win     # Windows (.exe)
npm run build:electron:linux   # Linux (.AppImage)
```

**Build Output**:
- Distributables will be created in the `dist/` directory
- macOS: `SplicR-1.0.0.dmg` and `SplicR-1.0.0-mac.zip`
- Windows: `SplicR Setup 1.0.0.exe` and `SplicR-1.0.0-win-portable.exe`
- Linux: `SplicR-1.0.0.AppImage`, `.deb`, and `.rpm` packages

**Note**: The desktop app connects to the same Supabase backend as the web version, ensuring data consistency across platforms.

### Project Structure

```
frontend/
├── app/                    # Next.js App Router pages
├── components/             # React components
├── lib/                    # Utility functions and hooks
├── main/                   # Electron main process
│   └── background.js      # Electron entry point
├── public/                 # Static assets
├── build/                  # Electron build configuration
│   └── entitlements.mac.plist
├── next.config.js         # Next.js configuration
├── package.json           # Dependencies and scripts
└── electron-build.js      # Custom Electron build script
```

### Key Technologies

- **Next.js 16**: React framework with App Router
- **Supabase**: Backend as a Service (authentication, database, storage)
- **Electron**: Desktop app framework
- **Tailwind CSS**: Utility-first CSS framework
- **Recharts & Plotly**: Data visualization
- **TypeScript**: Type-safe development

### Environment Variables

Required environment variables (create `.env.local`):

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Additional configuration
R2_ACCOUNT_ID=your_r2_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET_NAME=your_bucket_name
R2_ENDPOINT=your_r2_endpoint
```

### Desktop App Configuration

The desktop app is configured to:
- ✅ Connect to Supabase securely
- ✅ Use native system features (macOS rounded corners, vibrancy)
- ✅ Handle external links in the system browser
- ✅ Sandbox all web content for security
- ✅ Disable remote module and unsafe eval
- ✅ Include proper entitlements for macOS code signing

### Security

Both web and desktop versions include:
- Context isolation in Electron
- Sandboxed renderer processes
- No `nodeIntegration`
- Secure handling of external URLs
- Environment variable validation

### Distribution

**For macOS**:
- App is configured with hardened runtime
- Includes entitlements for required permissions
- Ready for notarization and App Store distribution

**For Windows**:
- NSIS installer with user-configurable install location
- Desktop and Start Menu shortcuts
- Uninstaller included

**For Linux**:
- AppImage (universal, no installation required)
- .deb packages (Debian/Ubuntu)
- .rpm packages (Fedora/RHEL)

### Visual Consistency

The desktop app maintains 100% visual parity with the web version:
- ✅ Same fonts (inherited from Tailwind CSS configuration)
- ✅ Same colors and themes
- ✅ Same layout and spacing
- ✅ Same components and interactions
- ✅ Responsive design preserved

### Known Issues

See [ELECTRON_SETUP.md](./ELECTRON_SETUP.md) for details on the current development mode limitations.

## License

[Your License Here]

## Support

For issues or questions:
- Web app: Visit [splicr.org/support](https://splicr.org/support)
- Desktop app: File an issue in the GitHub repository

---

Built with ❤️ for the CRISPR research community
