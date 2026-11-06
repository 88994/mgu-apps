# Phone Terminal — MGU/iDrive 7

Run temporary shell commands on an already-rooted head unit through a phone browser instead of connecting a Windows laptop over ENET/OBD.

## Installation

Select the **main branch** of `NamelsMissing/mgu-apps` in MGU Store, then install **Phone Terminal**. The Store also needs to install its required tool `mgu-phone-bridge` (version 0.1.0). This tool is a systemd service running as root, not a normal OAP app. It uses no SSH private key; it runs commands on the local MGU.

Open **Phone Terminal** on the head unit, press **New session**, and scan the QR code with the phone camera. A local website opens where a command can be submitted and stdout/stderr displayed. Use **Revoke access** on iDrive or **Disconnect** on the website when finished.

## Security

- The in-car control interface is bound to `127.0.0.1:18891` and authenticated with an app-owned, mode-0600 key. The daemon creates the key after the OAP app directory appears.
- Phone HTTP runs on port `18890` and is locked until the app creates a new QR token. QR pairing is one-time and expires after 3 minutes; a paired session lasts 15 minutes.
- The QR code's token is a URL fragment, not sent in HTTP requests. Login changes it into an HttpOnly, SameSite=Strict session cookie; requests require a matching browser origin.
- Only one noninteractive command may run at once. Each command is killed after 15 seconds or 60 KB of output. Revoking access also kills a running command.
- **Do not expose port 18890 to the internet.** Connections use local HTTP, not HTTPS; use a trusted private network. A scanned QR code is not proof that the iPhone can route to the MGU. Test CarPlay Wi-Fi Direct connectivity on your vehicle.
- **Only use when parked.** Incorrect root commands can brick or destabilize the head unit. No speed gating is implemented in the daemon.

## Known limitations

- The console is not an interactive SSH/PTY session: shell prompts, `vi`, interactive `top`, etc. are not supported.
- The current daemon locates app data from `/var/opt/public/oap/oap_12201/data/apps/mgu_phone_terminal.json`. Other firmware layouts may need adaptation.
- Not yet tested on Jürgen's physical MGU. Local integration tests pass; root service start-up and browser networking still need on-car verification.

## Sources and licenses

The app uses the shared `kit/` already in this repository (MIT). QR generation uses `qrcode-generator` (MIT); see `QR-LICENSE`. No BMW SDK, SSH key or car-specific data is committed.
