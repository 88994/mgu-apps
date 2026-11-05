#!/bin/sh
# Read-only discovery; safe to run over SSH on a parked iDrive 7 MGU.
# Reports candidates only. It does not install or start browser processes.
echo 'MGU HTML runtime probe (read-only)'
uname -a
for executable in chromium chromium-browser google-chrome firefox webkit2gtk-driver \
    QtWebEngineProcess qmlscene qml qmltestrunner; do
    if command -v "$executable" >/dev/null 2>&1; then
        command -v "$executable"
    fi
done
for directory in /usr/bin /usr/lib /usr/lib64 /opt; do
    if [ -d "$directory" ]; then
        find "$directory" -maxdepth 3 -type f \
            \( -iname '*chromium*' -o -iname '*webkit*' -o -iname '*webengine*' \) \
            -print 2>/dev/null
    fi
done
echo 'END - detection is not proof of HMI integration'
