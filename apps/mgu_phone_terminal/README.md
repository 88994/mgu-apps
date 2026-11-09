# Phone Terminal — MGU/iDrive 7

Run temporary shell commands on an already-rooted head unit through a phone browser instead of connecting a Windows laptop over ENET/OBD.

## Installation

Select the **main branch** of `NamelsMissing/mgu-apps` in MGU Store, then install **Phone Terminal** (version 0.1.3) and update its required tool `mgu-phone-bridge` (version 0.1.2). This tool is a systemd service running as root, not a normal OAP app. It uses no SSH private key; it runs commands on the local MGU.

Open **Phone Terminal** on the head unit, press **New session**, and scan the QR code with the phone camera. A local website opens where a command can be submitted and stdout/stderr displayed. Use **Revoke access** on iDrive or **Disconnect** on the website when finished.

## Security

- The in-car control interface is bound to `127.0.0.1:18891` and authenticated with an app-owned, mode-0600 key. The app creates the key in its own data directory on first start; the daemon can also provision it if the directory already exists. The daemon assigns the private file to the registered OAP user ID rather than blindly copying the data directory owner; root-owned legacy keys can be migrated safely. The daemon never accepts an unauthenticated request to provision a root-control key.
- Phone HTTP runs on port `18890` and is locked until the app creates a new QR token. QR pairing is one-time and expires after 3 minutes; a paired session lasts 15 minutes.
- The QR code's token is a URL fragment, not sent in HTTP requests. Login changes it into an HttpOnly, SameSite=Strict session cookie; requests require a matching browser origin.
- Only one noninteractive command may run at once. Each command is killed after 15 seconds or 60 KB of output. Revoking access also kills a running command.
- **Do not expose port 18890 to the internet.** Connections use local HTTP, not HTTPS; use a trusted private network. A scanned QR code is not proof that the iPhone can route to the MGU. Test CarPlay Wi-Fi Direct connectivity on your vehicle.
- **Only use when parked.** Incorrect root commands can brick or destabilize the head unit. No speed gating is implemented in the daemon.

## Known limitations

- The console is not an interactive SSH/PTY session: shell prompts, `vi`, interactive `top`, etc. are not supported.
- The current daemon locates app data from `/var/opt/public/oap/oap_12201/data/apps/mgu_phone_terminal.json`. Other firmware layouts may need adaptation.
- Version 0.1.2 showed `App key setup: EACCES` on Jürgen's MGU. The likely cause is the previous daemon using the folder owner's uid rather than the app's registered `userId` for its 0600 key. Version 0.1.3/bridge 0.1.2 fixes that ownership rule and reports both file UID and app process UID if access is still denied. This remains a hypothesis until verified on-car; daemon start-up and browser networking also remain unverified.

## Sources and licenses

The app uses the shared `kit/` already in this repository (MIT). QR generation uses `qrcode-generator` (MIT); see `QR-LICENSE`. No BMW SDK, SSH key or car-specific data is committed.
