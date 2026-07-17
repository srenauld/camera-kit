# DJI Osmo Nano protocol

## System shape

The normal connection lifecycle is:

```text
BLE scan/connect
  -> subscribe FFF4, write raw DUML on FFF5
  -> query SSID/password/BSSID
  -> join the camera Wi-Fi network
  -> UDP session handshake to 192.168.2.1:9004
  -> reliable wrapper carrying DUML and H.264
  -> optional TCP 7001 zero-byte keepalive for preview
  -> HTTP port 80 for media bytes
```

WiFi connects to DJI Osmo Nano on subnet `192.168.2.199/24`; the camera gateway was 
`192.168.2.1`. 

## DUML

BLE carries DUML directly. Wi-Fi carries the same packets inside the UDP wrapper.

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0 | 1 | `55` start byte |
| 1..2 | 2 | 10-bit total length plus version bits |
| 3 | 1 | header CRC-8 |
| 4 | 1 | sender |
| 5 | 1 | receiver |
| 6..7 | 2 | sequence, little-endian |
| 8 | 1 | request/response flags |
| 9 | 1 | command set |
| 10 | 1 | command |
| 11..n-3 | variable | payload |
| n-2..n-1 | 2 | packet CRC-16, little-endian |

Length:

```text
length = byte[1] | ((byte[2] & 0x03) << 8)
byte[2] = 0x04 | ((length >> 8) & 0x03)
```

Normal app requests use sender `02`, receiver `01`, and flags `40`. Responses use
sender `01`, receiver `02`, flags `c0`, and the request's DUML sequence. Some camera
subcomponents use other receiver IDs; those are called out per command.

Checksums:

```text
CRC-8:  init 0x77, reflected polynomial 0x8c, bytes 0..2
CRC-16: init 0x3692, reflected polynomial 0x8408, bytes 0..n-3
```

Equivalent conventional parameter descriptions are CRC-8 polynomial `0x31`, init
`0xee`, RefIn/RefOut true; and CRC-16 polynomial `0x1021`, init `0x496c`,
RefIn/RefOut true. Store the CRC-16 little-endian.

Example, physically verified start-record request:

```text
550e04660201aed4400202014f2f
```

Decode it as sender `02`, receiver `01`, sequence `d4ae`, flags `40`, command set
`02`, command `02`, payload `01`.

## BLE bootstrap and control boundary

**Verified over BLE:** discovery of FFF0, notification subscription on FFF4, raw
complete-DUML writes on FFF5, the three credential queries below, a `02/8e`
stabilization readback, mode-family and format writes, and `02/02` recording
start/stop. The tablet test had Wi-Fi disabled and Mimo force-stopped;
the camera connected directly over BLE, accepted all six GATT writes, and audibly
confirmed a 5.175-second recording transition. The initial 250-ms 1080p240 restore
after the slow-motion family switch returned `df`; retrying after a five-second
settling delay returned `00` and visibly restored 1080p/8x.

The readback request was `02/8e` payload `00 01 08 00`; its matching BLE response
had status `00` and returned value `00` (stabilization Off). This proves that
non-bootstrap DUML is accepted over BLE; it is not restricted to credentials.

The BLE test verified format writes by matching the camera's status-`00` responses
and observing the restored camera UI; a complete generic format readback command is
still unmapped. Media enumeration, original-file download, and deletion were not
part of this BLE phase. Wi-Fi remains required for the documented original-media
transfer.

The retained HCI trace was subsequently reassembled through ATT/L2CAP. It proves the
independent probe received the matching `b302` start and `b303` stop responses, but
between those responses the camera emitted only `00/f1` heartbeat packets and
`00/74 2901` telemetry; it emitted no `00/99` named state record. The later Mimo
connection emitted idle `00/99` records named `cam_record_time` and `cam_status`.
`cam_record_time`'s observed opaque value was `0600000000000000`; it must not be
interpreted as an elapsed time or recording flag without a capture containing a
known state transition. `decode-ble-state.mjs` is the offline HCI decoder for this
envelope and deliberately reports those values as opaque.

### BLE recording-state notification

**Verified, two BLE-only runs:** after enabling every available vendor CCCD (FFF3,
FFF4, FFF5, FFF7), only FFF4 delivered traffic. It emits a roughly 10 Hz `02/80`
DUML status stream. Its first ATT fragment contains a 73-byte DUML header and the
initial payload bytes `01 02 80 SS 02 80 ...`; `SS` is a repeatable recording-phase
field. In both runs it changed as follows:

| Phase | `SS` | Timing after the relevant BLE write |
| --- | ---: | --- |
| Initial observed state | `01` | before start / after settling |
| Start transition | `41` | 544 ms; 614 ms |
| Stable recording state | `81` | 1.348 s; 1.419 s |
| Stop transition | `c1` | 159 ms; 244 ms |
| Settled non-recording state | `01` | 882 ms; 1.125 s |

The status stream continues during recording and has about 100-ms sample spacing.
Use the first `81` notification as the BLE-observed *recording active* edge and the
`c1` as the BLE-observed *stop transition*; `01` is post-recording teardown, not the
clip end. `41` is the earlier start-transition marker.

#### Frame-validated 1080p240 timing

A BLE-only run displayed a six-colour code on the tablet every 100 ms while recording.
The original slow-motion MP4 was decoded frame-by-frame using dominant screen-region
colour, which tolerates tablet scanlines. The first and last visible colours were
matched to Android monotonic screen-code timestamps:

| Measurement | Result |
| --- | ---: |
| `81` → `c1` BLE interval | 6.705 s |
| Original MP4 capture duration | 6.452279 s |
| Difference | 252.721 ms |
| Clip start after first `81` | 53–93 ms |
| Clip end before first `c1` | 160–200 ms |

This proves the tested control workflow is fully operable over BLE and that BLE
provides an actionable camera-state timeline. For 240-fps timing, use first `81` as
the start marker with a conservative `<100 ms` video-start error budget, and `c1` as
the stop marker knowing the last encoded frame is typically 160–200 ms earlier.
The status sample cadence adds up to about 100 ms of reporting quantisation. Do not
use `01` as an end-of-clip timestamp.

### BLE client recording contract

`DjiOsmoNanoHandle.record()` first requires the matching status-`00` response to its
`02/02 01` write, then resolves only at the first subsequently observed `81` FFF4
status notification. Its `recordingActiveAt` result is sampled from the caller's
injected monotonic clock at that notification. It must not resolve on the command
acknowledgement or the earlier `41` transition. `stop()` analogously requires its
status-`00` response and resolves at `c1`, rather than waiting for teardown `01`.

`decode-ble-probe-log.mjs` reassembles complete packets from the probe log; the short
leading fragment of `02/80` is intentionally retained as a timestamped status
fragment because the camera interleaves its longer payload with other notifications.

`android-ble-probe/` is the deliberately disposable hardware evidence harness for
resolving this boundary. It validates supplied DUML frames before writing them, keeps
Wi-Fi out of its control phase, and emits uncommitted JSONL evidence. Update this
section only with a matching BLE response plus physical camera-state confirmation;
an Android GATT write success alone is insufficient.

GATT identifiers:

| Purpose | UUID / handle |
| --- | --- |
| Service | `0000fff0-0000-1000-8000-00805f9b34fb` |
| Auxiliary vendor values | FFF3 (handle `0x002a`) and FFF7 (handle `0x0033`) |
| Notifications | FFF4, value handle `0x002d` |
| Notification CCCD | handle `0x002e` |
| Writes | FFF5, value handle `0x0030` |

Enable notifications on FFF4, then use ATT Write Command on FFF5. The characteristic
value is one complete raw DUML packet; there is no extra BLE frame.

All four vendor value characteristics (FFF3, FFF4, FFF5, and FFF7) advertise the
GATT Read property. A 2026-07-19 read-only connection read each one without writing
DUML; every read succeeded and returned the same static two-byte value `01 00`.
They therefore are not a readable current-camera-state API. FFF3, FFF4, and FFF7
also advertise Notify/Indicate, but only FFF4 was observed to carry camera traffic;
its notifications are raw DUML packets. The only discovered descriptors are the
standard `0x2902` CCCDs, which control delivery and do not contain state.

Credential requests are empty-payload DUML requests in command set `07`:

| Command | Successful response after leading status `00` |
| ---: | --- |
| `07` | UTF-8 Wi-Fi SSID |
| `0e` | UTF-8 Wi-Fi password |
| `0c` | six BSSID/MAC bytes |

Use a new DUML sequence for every request. Reject a nonzero leading response status.
Join the returned network without logging or persisting the password beyond the
platform's protected Wi-Fi credential store.

## UDP handshake and envelope

Control, state pushes, and preview all use camera UDP port `9004`.

### Session creation

Choose a fresh random unsigned 16-bit session ID. Do not reuse Mimo's active session:
hardware tests showed that a reused ID can collide with its existing reliable window.
Bytes 2..3 store the session in big-endian order.

For session `e98f`, send this 48-byte handshake:

```text
3080e98f000000d6487f64006400c005140000640000019001c005140000640014006400c00514000064000101040102
```

The camera replies:

```text
0980e98f000000ef01
```

The reply repeats the session and ends in status `01`. `encodeWifiHandshake()`
generates the request for an arbitrary session. This exact exchange was reproduced
from a standalone socket bound to the tablet's Wi-Fi interface.

### Common fields

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0..1 | 2 | low 12 bits: datagram length; high nibble: type (`0x80` observed) |
| 2..3 | 2 | session, big-endian |
| 4..5 | 2 | transmit cursor for data/video, little-endian |
| 6 | 1 | channel |
| 7 | 1 | XOR of bytes 0 through 6 |
| 8..19 | 12 | reliable-window state, channel-specific |
| 20.. | variable | channel payload |

The byte-7 rule is exact:

```text
checksum = byte[0] ^ byte[1] ^ ... ^ byte[6]
```

Channels:

| Channel | Direction | Purpose |
| ---: | --- | --- |
| `00` | client -> camera | session handshake |
| `01` | camera -> client | reliable ACK/window and often batched DUML data |
| `02` | camera -> client | H.264 preview fragments |
| `03` | camera -> client | direct DUML response |
| `04` | client -> camera | reliable ACK/window |
| `05` | client -> camera | DUML request |

For channels 3 and 5, DUML begins at offset 20. Channel 1 has a 14-byte reliable
subheader, so its first DUML begins at offset 34; multiple DUML packets can be
concatenated. Scan for `55`, use the declared DUML length, and accept a candidate
only after both CRCs validate.

### Sending commands

The first channel-5 command after a fresh handshake uses:

```text
transmit cursor = 0x7f50
previous cursor = 0x7f48
ordinal         = 0x0101
```

Channel-5 header layout used by `encodeWifiCommand()`:

| Offset | Value |
| --- | --- |
| 4..5 | current transmit cursor, LE |
| 6 | `05` |
| 8..9 | current cursor minus 8, LE |
| 10..11 | current cursor, LE |
| 12..15 | zero |
| 16..17 | packet ordinal, LE |
| 18..19 | zero |

After each datagram, add 8 to the 16-bit transmit cursor and 1 to the 16-bit ordinal,
with wraparound. Recompute byte 7 after length, session, cursor, and channel are set.

The sanitized first-command fixture is `fixtures/wifi-setting-query.hex`. A prior
version of that fixture had a copied checksum; the regression test now verifies the
correct value (`e9` for that 37-byte `e98f` packet).

### Acknowledging camera data

For each channel-1 datagram of at least 34 bytes:

1. Copy its first 34 bytes.
2. Set length/type bytes to `22 80`.
3. Change channel byte 6 from `01` to `04`.
4. Put the most recently transmitted cursor at bytes 26..27 LE.
5. Set bytes 32..33 to zero.
6. Recompute byte 7 as XOR(bytes 0..6).
7. Send the 34-byte result to port 9004.

This transforms a captured camera packet:

```text
2280e98f000001c5487f487f00000000487f487f00000000487f487f000000000000
```

into the paired Mimo ACK after cursor `0x7f50` was sent:

```text
2280e98f000004c0487f487f00000000487f487f00000000487f507f000000000000
```

`acknowledgeWifiDatagram()` implements and tests this transformation. ACK promptly
(Mimo usually emitted cumulative ACKs within tens of milliseconds). Duplicate ACKs
are harmless in the bounded standalone tests.

### Responses, errors, and recovery

Match DUML responses by sequence, command set, and command. The first payload byte is
commonly a status code. `00` means success for the commands verified here.

A standalone `02/8e` query before Mimo-style parameter registration returned payload
`df`: transport and DUML were accepted, but the command context was not initialized.
Do not treat any syntactically valid response as success without checking status.

Recommended timeouts:

- handshake: 1 second, retry twice with the same session, then choose a new session;
- command: 500 ms for ordinary controls, retry once with a new DUML sequence;
- after repeated loss/window disagreement: discard the UDP socket and reconnect with
  a new session instead of guessing the vendor congestion state.

## Camera modes and settings

Do not choose a default in the protocol layer. Expose the complete capability matrix
and let application policy select a row. The machine-readable source of truth is
`fixtures/camera-capabilities.json`.

### Mode family

Command `02/e1`:

| Payload | Mode |
| ---: | --- |
| `01` | normal Video |
| `00` | Slow Motion |

Set the mode family before setting its format.

### Recording format

Command `02/18`, five-byte payload:

```text
[resolutionEnum, fpsEnum, 00, slowFactor, 00]
```

Resolution enums:

| Format | Enum |
| --- | ---: |
| 1080p 16:9, 1920x1080 | `0a` |
| 1080p 4:3, 1920x1440 | `0c` |
| 2.7K 16:9, 2688x1512 | `2d` |
| 2.7K 4:3, 2688x2016 | `5f` |
| 4K 16:9, 3840x2160 | `10` |
| 4K 4:3, 3840x2880 | `67` |

FPS enums:

| FPS | Enum |
| ---: | ---: |
| 24 | `01` |
| 25 | `02` |
| 30 | `03` |
| 48 | `04` |
| 50 | `05` |
| 60 | `06` |
| 120 | `07` |
| 240 | `08` |

Normal Video uses slow factor `00`. Supported rows:

| Resolution/aspect | FPS |
| --- | --- |
| 4K 4:3 | 24, 25, 30, 48, 50 |
| 4K 16:9 | 24, 25, 30, 48, 50, 60 |
| 2.7K 4:3 | 24, 25, 30, 48, 50, 60 |
| 2.7K 16:9 | 24, 25, 30, 48, 50, 60 |
| 1080p 4:3 | 24, 25, 30, 48, 50, 60 |
| 1080p 16:9 | 24, 25, 30, 48, 50, 60 |

Slow Motion rows and complete `02/18` payloads:

| Mode | Payload |
| --- | --- |
| 4K120, playback 4x slow | `10 07 00 04 00` |
| 2.7K120, playback 4x slow | `2d 07 00 04 00` |
| 1080p120, playback 4x slow | `0a 07 00 04 00` |
| 1080p240, playback 8x slow | `0a 08 00 08 00` |

All four slow-motion options were physically selectable. A 1080p240 recording was
started, stopped, and saved. 4K60 with stabilization Off was physically selected.
The direct 4K60 format write itself was missed during one tap capture; enum `06` is
supported by the camera capability/UI, DJI's published matrix, and the contiguous FPS
enum. This is the only distinction between physical state verification and an
isolated `02/18` packet in the table.

### Stabilization

Stabilization is parameter ID `0x0008` through command `02/8e`.

Query payload:

```text
00 01 08 00
```

Write payload:

```text
01 01 08 00 01 <value>
```

Values:

| Setting | Value |
| --- | ---: |
| Off | `00` |
| RockSteady | `01` |
| HorizonBalancing | `04` |
| HorizonCorrection | `07` |

Captured HorizonCorrection write:

```text
551304030201408a40028e0101080001072ee8
```

The camera may reject stabilization choices incompatible with a selected format.
Expose the setting independently and surface camera status; do not silently
downgrade resolution or frame rate.

### Color profile and bit depth

Command `02/42`, one-byte payload:

| Setting | Value |
| --- | ---: |
| Normal 8-bit | `00` |
| D-Log M 10-bit | `3d` |
| Normal 10-bit | `3f` |

Captured Normal 10-bit write:

```text
550e04660201f08f4002423f99fa
```

### Lens/FOV

The Nano advertised `camcap_fov`/`cam_fov`, and Mimo displayed `Standard` in tested
modes. No independent multi-lens selector was found. Model this as an optional
single-value capability; do not invent multiple lenses or make a lens field mandatory.

### Recommended transactional order

For a requested configuration:

1. Stop recording if necessary.
2. Send `02/e1` for Video or Slow Motion and require status `00`.
3. Validate the requested row against the complete matrix.
4. Send `02/18` and require status `00`.
5. Apply stabilization via `02/8e`, if requested.
6. Apply color via `02/42`, if requested.
7. Read back state where available; never assume the camera accepted an incompatible
   combination.

## Recording to camera storage

Command `02/02`, one-byte payload:

| Payload | Action |
| ---: | --- |
| `01` | start recording |
| `00` | stop recording |

Captured and physically verified packets:

```text
start: 550e04660201aed4400202014f2f
stop:  550e0466020125d640020200c900
```

Require response status `00`. State pushes named `cam_record_time` and `cam_status`
are useful confirmation, but their full opaque records need not be decoded to issue
the command. Recording transitions interrupt preview for about 0.8 seconds; do not
interpret that gap as a disconnected camera.

## Live preview

### Start and supporting pipeline sequence

Primary start command, receiver `01`:

```text
command 02/0c
payload 01 01 00 00
```

Entering playback used the same command with final byte `01`:

```text
01 01 00 01
```

The standalone probe sent only the start command and received a matching status `00`,
but no channel-2 packets in five seconds. In the complete Mimo trace, the first H.264
packet arrived 835 ms after `02/0c`, following this observed pipeline sequence:

| Receiver | Command | Payload |
| ---: | --- | --- |
| `1c` | `53/15` | `02` |
| `01` | `00/4f` | `04 00 00 00 00 00 00 00 00` |
| `01` | `02/09` | `00 00 00 00 00 00 00 00 00 00 03` |
| `01` | `02/09` | same payload again |
| `41` | `09/a8` | `00 04 02 00 00 00 00 00 00 00` |

The first video packet arrived 277 ms after `09/a8`. Mimo repeated the `02/09` plus
`09/a8` pair shortly afterward. This sequence is **observed**, not independently
minimized. A clean implementation should send it after successful `02/0c`, tolerate
status/state pushes between requests, and repeat the final pair once if no channel-2
packet arrives within one second.

Also open TCP `192.168.2.1:7001` and write one zero byte approximately once per second
while preview is desired. Mimo did this in every working preview session. TCP 6001
was reset and is not needed.

### Video framing and reassembly

Preview is H.264 Annex-B, observed at 1080p30. Channel-2 UDP packets use the common
20-byte wrapper.

The first fragment of every observed access unit has a 16-byte video header at
offset 20. Its first four bytes are:

```text
00 00 01 ff
```

Annex-B bytes therefore begin at offset 36 in a first fragment. Continuation
fragments have no 16-byte video header; append their bytes beginning at offset 20.
The next `00 00 01 ff` first-fragment marker terminates the previous access unit.

The wrapper transmit cursor at bytes 4..5 advances by 8 per video datagram. If the
next continuation cursor is not `(previous + 8) & 0xffff`, discard the incomplete
access unit and resynchronize at the next first-fragment marker. `createVideoAssembler()`
implements this policy. Bytes 16..19 also contain fragment class/index information,
but their exact flag semantics are unnecessary for in-order reassembly.

Inspect Annex-B NAL types:

- type 7: SPS;
- type 8: PPS;
- type 5: IDR/keyframe slice;
- type 1: non-IDR slice.

Preserve SPS/PPS with the following IDR. Timestamp an access unit on receipt unless
a future capture maps a camera clock field. Do not fabricate capture-time precision.

### Actual preview rate

`fixtures/preview-observations.json` contains the measurements:

| Camera configuration | Recording | Observed preview FPS |
| --- | --- | ---: |
| 4K60 | no | 28.91 |
| 1080p240 Slow Motion | no | 28.95 |
| 4K60 | yes | 28.96 |
| 1080p240 Slow Motion | yes | 28.91 |

Preview is 30 fps regardless of recording at 60/120/240 fps. It is suitable
for live shot detection and a rolling context buffer, but not high-speed arrow-flight
analysis. For that, record on camera and analyze the downloaded original.

## Media enumeration

Entering the media/playback view sends:

```text
command 03/da
payload 05 ff ff ff ff
```

The camera sends the list as unsolicited command `00/27` fragments. Its DUML payload:

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0..1 | 2 | constant `4a 01` |
| 2..3 | 2 LE | low 12 bits: payload length; bit `0x1000`: final fragment |
| 4..5 | 2 LE | transaction ID |
| 6..9 | 4 LE | zero-based fragment index |
| 10.. | variable | body fragment |

Collect a single transaction, reject duplicates, and reassemble indices 0 through
the one marked final. The captured list had 13 fragments, 12,757 body bytes, and 36
entries. `reassembleMediaList()` checks gaps, duplicates, mixed transactions, and the
single-final invariant.

The reassembled body begins with a little-endian entry count. The surrounding record
format contains opaque fields, but these stable markers are sufficient:

```text
record index:  8a 01 <u32le index> <u32le (index | 0x4000)>
filename:      ASCII DJI_YYYYMMDDhhmmss_NNNN_D.MP4 or .JPG
original path: 1a <u32le container length> 01 <NUL-terminated ASCII base path> ...
thumbnail:     1a <u32le container length> 02 <NUL-terminated ASCII base path> ...
```

For a filename occurrence, scan forward a bounded distance for path type 1, then type
2. The little-endian length bounds an enclosing value and can include control fields
after the path; stop the ASCII path at its first NUL. Append the filename's extension
to the original base path. For MP4, append `.lrf` instead to obtain the low-resolution
proxy. Verify decoded entry count against the body's declared count.
`parseMediaEntries()` applies these rules and decoded all 36 captured entries without
control bytes in any returned path.

Example:

```text
filename: DJI_20260718102718_0036_D.MP4
original: DCIM/DJI_001/DJI_20260718102718_0036_D.MP4
proxy:    DCIM/DJI_001/DJI_20260718102718_0036_D.lrf
thumb:    MISC/THM/DJI_001/DJI_20260718102718_0036_D
```

## Original-file transfer

Media bytes are ordinary HTTP on camera port 80:

```http
GET /v2?storage=1&path=DCIM/DJI_001/DJI_20260718102718_0036_D.MP4 HTTP/1.1
Host: 192.168.2.1
Range: bytes=0-1023
```

Percent-encode the query parameter value without changing path separators. The
verified original response was:

- status `206 Partial Content`;
- `Content-Type: video/mp4`;
- `Accept-Ranges: bytes`;
- `Content-Range: bytes 0-1023/44993051`;
- `ETag` and `Last-Modified` present.

Mimo fetched `.lrf` for its lightweight playback download. A direct range request for
the `.MP4` returned original MP4 bytes. Therefore original transfer does not require
a proprietary media command after enumeration.

Use resumable downloads:

1. Request a byte range and parse total length from `Content-Range`.
2. Persist ETag/Last-Modified with partial state.
3. Resume at the first missing byte with `Range` and preferably `If-Range: <ETag>`.
4. Reject an unexpected `200` during resume unless deliberately restarting.
5. Verify every `Content-Range` start/end and final byte count.

## Implementation state machine

```text
DISCONNECTED
  -> BLE_CONNECTED
  -> CREDENTIALS_READY
  -> WIFI_JOINED
  -> UDP_HANDSHAKING
  -> CONTROL_READY
       -> PREVIEW_STARTING -> PREVIEWING
       -> RECORDING
       -> PLAYBACK_MODE -> ENUMERATING -> DOWNLOADING
```

Rules:

- Generate a fresh Wi-Fi session on every control connection.
- Keep DUML sequence, UDP cursor, and UDP ordinal as separate counters.
- Process/ACK channel 1 even while waiting for a direct channel-3 response.
- Serialize format-family changes, but allow state pushes and ACK traffic at all
  times.
- Treat preview interruption during record transitions as expected.
- Stop preview or switch to playback before media enumeration.
- On transport desynchronization, reconnect; do not silently report a successful
  camera setting.

## Reference artifacts and tests

- `protocol.mjs`: CRCs, DUML codec, handshake/command/ACK construction, video
  reassembly, media fragment and entry parsing.
- `protocol.test.mjs`: captured-fixture and failure-path tests.
- `fixtures/camera-capabilities.json`: complete format/settings matrix.
- `fixtures/preview-observations.json`: measured preview behavior.
- `extract-att.mjs`: BLE ATT extractor.
- `extract-duml.mjs`: DUML extractor around timestamped actions.
- `analyze-wifi.mjs`: UDP wrapper analyzer.
- `analyze-preview.mjs`: Annex-B slice-rate analyzer.
- `decode-media-list.mjs`: captured media-list decoder.

Run the self-contained reference tests from the repository root:

```sh
node --test packages/camera/docs/reverse-engineering/protocol.test.mjs
```

The tests require no camera, APK, network, or packet capture.