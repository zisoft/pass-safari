# pass-safari

A Safari extension for the [pass](https://www.passwordstore.org/) standard Unix password manager.

## Features

- Access your pass password store from Safari
- Auto-suggest passwords based on the current URL
- Support for TOTP/OTP codes
- Secure architecture with minimal permissions
- Simple file-based communication between extension and app

## Installation

### Requirements

- macOS 11.0 or later
- Xcode 13.0 or later (for building)
- pass password manager installed and configured

### Building from Source

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/pass-safari.git
   cd pass-safari
   ```

2. Open the project in Xcode:
   ```bash
   open pass-safari.xcodeproj
   ```

3. Build and run the project (⌘R)

4. Enable the extension in Safari:
   - Safari → Preferences → Extensions
   - Enable "pass-safari Extension"

## Architecture

### Simple File-Based Communication

The extension uses a simple, proven approach with files in `~/.pass-safari/`:

```
~/.pass-safari/
├── PasswordStoreSelection.plist       # Selected password store path
├── PasswordStoreSelectionEvent.plist  # Store selection events
├── PassRequest-*.plist                # Request files from extension
├── PassResponse-*.plist               # Response files from app
├── URLIndexCache.json                 # Cached URL mappings
└── URLIndexRefresh.lock               # Lock file for index refresh
```

### Why This Approach?

1. **Extension is sandboxed** - Can only access `~/.pass-safari/` and user-selected folders
2. **App is NOT sandboxed** - Can execute `/opt/homebrew/bin/pass` without issues
3. **No App Group complexity** - No permission prompts, simple file operations
4. **Works reliably** - Standard approach used by many Safari extensions

### Components

1. **Safari Extension** (`pass-safari Extension`)
   - Runs in Safari's sandboxed environment
   - Lists password entries
   - Manages UI and user interactions
   - Creates pass request files in `~/.pass-safari/`

2. **Companion App** (`pass-safari`)
   - Runs WITHOUT sandbox (needs to execute `pass`)
   - Reads password files via security-scoped bookmarks
   - Executes pass commands
   - Generates OTP codes
   - Writes pass response files to `~/.pass-safari/`

### Communication Flow

```
Safari Extension → PassRequest-*.plist (in ~/.pass-safari/)
                    ↓
Companion App reads request
                    ↓
Executes: /opt/homebrew/bin/pass show entry-name
                    ↓
Companion App → PassResponse-*.plist (in ~/.pass-safari/)
                    ↓
Safari Extension reads response → Displays password
```

## Usage

### First Run

1. Launch the pass-safari app
2. Choose your password store folder when prompted
3. The location is saved with a security-scoped bookmark

### In Safari

1. Navigate to a website
2. Click the pass-safari extension icon
3. Select a password entry from the list
4. The password is automatically filled or copied

### URL Matching

The extension automatically suggests passwords based on:
- Exact hostname matches
- Subdomain matches
- URL fields in password entries

## Security

- Extension runs in macOS App Sandbox with minimal permissions
- Companion app uses security-scoped bookmarks for password store access
- Communication via simple files in `~/.pass-safari/`
- No network access required
- No telemetry or tracking

## Development

### Project Structure

```
pass-safari/
├── pass-safari/                       # Companion app (NOT sandboxed)
│   ├── AppDelegate.swift              # App lifecycle & pass execution
│   ├── ViewController.swift           # UI
│   └── pass-safari.entitlements       # Empty (no sandbox)
├── pass-safari Extension/             # Safari extension (sandboxed)
│   ├── SafariWebExtensionHandler.swift  # Native messaging
│   ├── pass-safari Extension.entitlements  # Sandbox + ~/.pass-safari/ access
│   └── Resources/
│       ├── popup.html                 # Extension UI
│       ├── popup.js                   # Extension logic
│       └── background.js              # Background tasks
└── pass-safari.xcodeproj/             # Xcode project
```

### Key Files

- `SafariWebExtensionHandler.swift` - Handles messages from JavaScript, manages `~/.pass-safari/`
- `AppDelegate.swift` - Executes pass commands, reads/writes `~/.pass-safari/`
- `popup.js` - Extension UI logic and user interactions

### Entitlements

**Extension** (`pass-safari Extension.entitlements`):
- `com.apple.security.app-sandbox` - Required for Safari extensions
- `com.apple.security.files.bookmarks.app-scope` - Persistent store access
- `com.apple.security.files.user-selected.read-only` - Password store access
- `com.apple.security.temporary-exception.files.home-relative-path.read-write` - Access to `~/.pass-safari/`
- `com.apple.security.temporary-exception.files.home-relative-path.read-only` - Read password store

**Companion App** (`pass-safari.entitlements`):
- Empty! No sandbox, so it can execute `/opt/homebrew/bin/pass`

## Troubleshooting

### Extension not appearing in Safari
- Make sure the app is in `/Applications/` or `~/Applications/`
- Restart Safari completely
- Check Safari Preferences → Extensions

### Permission denied errors
- Ensure `~/.pass-safari/` exists and is writable
- Check that the companion app has been run at least once
- Verify the password store folder was properly selected

### Pass not found
The app looks for pass in:
- `/opt/homebrew/bin/pass`
- `/usr/local/bin/pass`
- `/usr/bin/pass`
- `/bin/pass`
- Or via `which pass` in your PATH

Make sure pass is installed: `brew install pass`

### "Failed to run 'pass': The file "pass" doesn't exist"
This means the companion app couldn't find the pass executable. Install it with:
```bash
brew install pass
```

### Debug logging
Check Console.app and filter by "pass-safari" for detailed logs.

## License

[Your license here]

## Contributing

[Contributing guidelines here]

## Credits

- Built for [pass](https://www.passwordstore.org/) by Jason A. Donenfeld
