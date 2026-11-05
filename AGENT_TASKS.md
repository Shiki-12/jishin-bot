# AGENT_TASKS.md: Daftar fitur untuk Mika Bot

Dokumen ini adalah spesifikasi kerja untuk AI agent coding. Taruh di root project (sejajar `README.md`).

## Prompt untuk agent (tinggal paste)

```
Kamu mengerjakan project bot Telegram di folder ini. Baca README.md dan AGENT_TASKS.md sampai habis dulu.

Aturan kerja:
1. Kerjakan fitur sesuai urutan ID di bagian "Urutan pengerjaan". Mulai dari F-00.
2. Satu fitur = satu sesi: implementasi, uji, update README.md dan .env.example, centang checklist progres, lalu berhenti.
3. Setelah selesai, laporkan: file apa yang berubah, cara mengujinya manual, dan hal yang belum beres.
4. Jangan merusak fitur yang sudah jalan. Jangan ganti stack. Tambah dependensi hanya kalau perlu, dan sebutkan alasannya.
5. Kalau spesifikasi ambigu atau butuh keputusan dariku (misalnya API eksternal yang belum jelas), tanya dulu, jangan menebak.
```

---

## Konteks project (kondisi sekarang)

- **Stack:** Node.js 20+ (ESM, tanpa TypeScript), [grammY](https://grammy.dev) untuk Telegram, `fetch` ke API LLM format OpenAI (`POST {LLM_BASE_URL}/chat/completions`), Giphy untuk GIF. Dijalankan di Windows (Laragon) saat development.
- **Struktur:**
  ```
  src/
    index.js              # bot: /start /forget /about, handler pesan teks, antrian per chat
    llm.js                # generateReply({ systemPrompt, history, userText }) + retry + fallback model
    giphy.js              # extractGif(raw) dan searchGif(query)
    memory.js             # riwayat chat di data/memory.json (role 'user' | 'model')
    personalities/
      index.js            # getPersonality(id), listPersonalities()
      tsundere.js         # { id, name, greeting, errorMessage, systemPrompt }
  ```
- **Alur chat sekarang:** pesan masuk, (di grup hanya kalau di-mention atau di-reply), ambil riwayat, panggil LLM dengan system prompt persona, pisahkan tag `[GIF: kata kunci]` dari balasan, kirim teks, lalu kirim GIF.
- **Catatan teknis penting:** riwayat disimpan dengan role `model`, dan `llm.js` yang memetakannya ke `assistant`. Balasan dikirim sebagai teks biasa tanpa `parse_mode`. Env dibaca lewat `dotenv/config` yang harus jadi import pertama di `index.js`.
- **Bahasa:** semua teks yang dilihat user dalam bahasa Indonesia santai. Persona aktif: **Mika**, cewek tsundere.

---

## Aturan umum untuk SEMUA fitur

1. **Modular.** Tiap fitur satu file di `src/features/<nama>.js` yang mengekspor objek:
   ```js
   export default {
     id: 'reminders',
     commands: [{ name: 'remind', description: 'Buat pengingat', handler: async (ctx) => {} }],
     tags: [{ name: 'REMIND', promptHint: '...', handle: async (ctx, args) => {} }],
     callbacks: [{ prefix: 'rem:', handler: async (ctx) => {} }],
     init: async ({ bot, db, scheduler }) => {},
   };
   ```
   `index.js` hanya memuat dan mendaftarkan modul. Jangan menumpuk logika fitur di `index.js`.
2. **Feature flag.** `.env` punya `FEATURES=reminders,todo,notes` (atau `all`). Fitur yang tidak aktif tidak mendaftarkan apa pun.
3. **Waktu.** Simpan selalu sebagai epoch milidetik UTC. Tampilkan dan parsing memakai timezone user (default `Asia/Jakarta`). Pakai `Intl.DateTimeFormat`, jangan menambah library tanggal kecuali benar-benar perlu.
4. **Dua jalur untuk tiap fitur.** (a) perintah slash yang deterministik dan tidak butuh LLM; (b) bahasa natural lewat tag aksi (lihat F-03), bila masuk akal.
5. **Konfirmasi deterministik.** Untuk aksi yang mengubah data (pengingat, to-do, catatan), bot selalu mengirim konfirmasi sendiri berisi hasil parse (misalnya "Oke, kuingetin Kamis 06 Nov 07:00 WIB: minum obat"). Jangan hanya percaya teks yang ditulis LLM.
6. **Gagal dengan aman.** Fitur non-LLM (pengingat, to-do, catatan) harus tetap jalan walau API LLM mati. Error satu fitur tidak boleh membuat bot crash. Semua handler dibungkus try/catch dan error dicatat.
7. **Tag aksi hanya dari output model.** Tag divalidasi ketat (format, panjang, rentang nilai). Tag tidak valid dibuang, lalu bot membalas pesan error in-character, bukan diam.
8. **Teks persona.** Kalimat tetap yang dilihat user (konfirmasi, error, sapaan) diambil dari `persona.strings.<kunci>` dengan fallback netral. Tambahkan objek `strings` ke tiap file persona, jangan hardcode di fitur.
9. **Tanpa Markdown mentah.** Kirim teks biasa. Kalau perlu format (daftar, tebal), pakai `parse_mode: 'HTML'` dan escape input user.
10. **Tes.** Pakai `node:test` bawaan Node. Parser waktu, parser tag, dan logika scheduler wajib punya tes. LLM selalu di-mock di tes.
11. **Dokumentasi.** Setiap fitur menambah bagian di `README.md` (perintah + contoh) dan variabel baru di `.env.example`.
12. **Keamanan.** Jangan pernah log token bot atau API key. Batasi panjang input user. Jangan simpan data sensitif di luar `data/`.

---

## Urutan pengerjaan

`F-00` → `F-01` → `F-02` → `F-03` → `F-04` → `F-05` → `F-10` → `F-11` → `F-12` → `F-13` → `F-14` → `F-15` → sisanya bebas sesuai prioritas.

## Checklist progres

**Fondasi**
- [x] F-00 Arsitektur modul fitur, /help, menu perintah
- [x] F-01 Database SQLite
- [x] F-02 Pengaturan per user/chat (/settings)
- [x] F-03 Protokol tag aksi + waktu sekarang di prompt
- [x] F-04 Penjaga: whitelist, rate limit, batas input
- [x] F-05 Aturan keselamatan di persona

**Harian**
- [x] F-10 Pengingat (reminders) ★ prioritas tertinggi
- [x] F-11 To-do list
- [x] F-12 Catatan
- [x] F-13 Pesan pagi dan malam terjadwal
- [x] F-14 Memori jangka panjang + ringkasan percakapan
- [x] F-15 Ganti persona + persona custom

**Companion dan hiburan**
- [x] F-20 Sistem affinity (level "dere")
- [x] F-21 Stiker
- [x] F-22 Mika chat duluan (proaktif)
- [x] F-23 Game kecil
- [x] F-24 Mood check-in dan jurnal

**Media**
- [x] F-30 Baca gambar (vision)
- [x] F-31 Voice note (STT/TTS)

**Utilitas**
- [x] F-40 Cuaca
- [x] F-41 Jadwal sholat
- [x] F-42 Kurs, kalkulator, konversi
- [x] F-43 Timer dan pomodoro
- [x] F-44 Habit tracker dan streak
- [x] F-45 Catat pengeluaran
- [x] F-46 Terjemah dan rangkum teks

**Grup**
- [x] F-50 Fitur grup

**Operasional**
- [x] F-60 Perintah admin
- [x] F-61 Ekspor dan hapus data
- [x] F-62 Deploy (Docker/PM2, webhook opsional)
- [x] F-63 Tes otomatis
- [x] F-64 Logging dan pemakaian token

---

# FONDASI

## F-00 Arsitektur modul fitur, /help, menu perintah
- Buat `src/features/` dan loader sesuai aturan umum no. 1 dan 2.
- `/help` dibuat otomatis dari `commands` semua fitur yang aktif (nama + deskripsi), dengan nada persona.
- Daftarkan ke Telegram dengan `bot.api.setMyCommands` saat start, supaya menu "/" muncul.
- Pindahkan `/start`, `/forget`, `/about` ke modul `core` tanpa mengubah perilakunya.
- **Selesai jika:** bot jalan seperti sebelumnya, `/help` menampilkan semua perintah aktif, dan menambah fitur baru cukup dengan membuat satu file di `src/features/`.

## F-01 Database SQLite
- Pakai `better-sqlite3` (sinkron, cepat, cocok untuk bot kecil). File di `data/bot.db`.
- `src/core/db.js`: buka koneksi, `PRAGMA journal_mode=WAL`, jalankan migrasi berurutan dari `src/core/migrations/001_*.sql`, `002_*.sql`, dst. Catat versi di tabel `schema_migrations`.
- Tabel awal: `users(id, first_name, username, tz, persona, lang, created_at)`, `chats(id, type, persona, created_at)`, `messages(id, chat_id, role, text, created_at)`.
- Pindahkan `memory.js` ke tabel `messages` dengan API yang sama (`getHistory`, `addMessage`, `clearHistory`, `flush`). Impor `data/memory.json` lama sekali jalan kalau ada.
- **Selesai jika:** riwayat chat bertahan setelah restart, `/forget` tetap bekerja, dan tidak ada lagi tulis-ulang file JSON besar.

## F-02 Pengaturan per user/chat (/settings)
- `/settings` menampilkan inline keyboard: zona waktu, persona, bahasa (id/en), seberapa sering GIF (jarang/normal/sering/mati).
- Zona waktu: pilihan cepat WIB/WITA/WIT plus input manual nama IANA (`/timezone Asia/Makassar`), divalidasi lewat `Intl`.
- Nilai disimpan di tabel `users`/`chats`. Sediakan helper `getSetting(ctx, key)` yang dipakai fitur lain.
- Frekuensi GIF mengubah satu baris di system prompt.
- **Selesai jika:** pengaturan tersimpan per user, dan perubahan zona waktu langsung dipakai fitur waktu.

## F-03 Protokol tag aksi generik + waktu sekarang di prompt
- Ganti `extractGif` yang khusus GIF menjadi `src/core/actions.js` dengan `extractActions(raw, registeredTags)`. Format tag: `[NAMA: arg1 | arg2 | arg3]`, ditaruh di baris akhir balasan, boleh lebih dari satu. GIF jadi salah satu tag (`GIF`) tanpa mengubah perilakunya.
- Setiap fitur menyumbang `promptHint` (instruksi singkat penggunaan tag) yang digabung ke system prompt persona saat bot memanggil LLM. Hanya tag fitur yang aktif yang dijelaskan.
- Tambahkan blok konteks dinamis di akhir system prompt setiap panggilan: tanggal dan jam sekarang di zona waktu user (contoh: `Sekarang: Rabu, 04 Nov 2026 20:12 WIB (Asia/Jakarta)`) dan nama user. Tanpa ini LLM tidak bisa memahami "besok" atau "jam 7".
- Validasi: nama tag harus terdaftar, jumlah argumen sesuai, panjang dibatasi. Tag yang gagal validasi dibuang dan dilaporkan ke handler error.
- Teks yang tampil ke user tidak boleh mengandung sisa tag.
- **Selesai jika:** GIF tetap jalan, tes parser mencakup tag ganda, tag rusak, tag di tengah teks, dan tag tidak terdaftar.

## F-04 Penjaga: whitelist, rate limit, batas input
- `ADMIN_IDS` (daftar user id Telegram) dan `ALLOWED_USER_IDS` (kosong = semua boleh) di `.env`.
- Rate limit per user: maksimal N panggilan LLM per menit (default 8), plus batas harian opsional. Kalau kena limit, balas in-character dan jangan panggil LLM.
- Batas panjang pesan masuk (default 2000 karakter) dan jumlah pesan di antrian per chat.
- Abaikan pesan dari bot lain dan update lama yang menumpuk saat bot mati (jangan proses pesan lebih tua dari beberapa menit kecuali fitur memang membutuhkannya).
- **Selesai jika:** user di luar whitelist tidak dilayani, spam tidak membakar kuota API, dan ada tes untuk limiter.

## F-05 Aturan keselamatan di persona
- Tambahkan ke semua system prompt persona: kalau user menunjukkan tanda krisis (ingin menyakiti diri, putus asa berat, dsb.), Mika **menghentikan akting tsundere**, menjawab hangat dan tenang, mendorong user menghubungi orang tepercaya atau layanan darurat/kesehatan jiwa setempat, dan tidak meremehkan perasaannya.
- Cantumkan nomor layanan resmi setempat di prompt. **Verifikasi nomornya dulu dari sumber resmi** sebelum dipakai, jangan menebak.
- Tambahkan aturan: Mika tidak memberi diagnosis medis atau saran obat/dosis, dan menyarankan tenaga profesional untuk topik itu.
- **Selesai jika:** ada tes manual terdokumentasi (contoh pesan + perilaku yang diharapkan) di README bagian "Pengujian persona".

---

# HARIAN

## F-10 Pengingat (reminders) ★

**Perintah**
- `/remind <waktu> <teks>` contoh: `/remind 10m minum obat`, `/remind 2j cek oven`, `/remind 17:30 pulang`, `/remind besok 07:00 olahraga`, `/remind 2026-12-01 09:00 bayar listrik`.
- Berulang: `/remind tiap hari 06:00 minum vitamin`, `tiap senin 08:00 rapat`, `tiap 2 jam stretching`, `tiap tgl 1 bayar kos`.
- `/reminders` menampilkan daftar pengingat aktif (id, waktu, teks, ulang) dengan tombol batal.
- `/cancel <id>` (atau tombol) membatalkan.

**Bahasa natural (lewat tag)**
- Format: `[REMIND: <ISO 8601 dengan offset> | <teks> | <ulang atau none>]`, contoh: `[REMIND: 2026-11-05T07:00:00+07:00 | minum obat | none]`.
- Hint prompt: hanya keluarkan tag kalau user jelas minta diingatkan. Kalau waktunya ambigu ("nanti", "sebentar lagi" tanpa angka), tanyakan balik, jangan menebak. Teks pengingat ditulis sebagai tugas user ("minum obat"), bukan kalimat Mika.
- Setelah tag diparse, bot mengirim konfirmasi deterministik (aturan umum no. 5).

**Scheduler** (`src/core/scheduler.js`)
- Satu loop `setInterval` tiap 15 sampai 30 detik: ambil pengingat `status='pending' AND due_at <= now` (batas 50 per putaran), kirim, lalu tandai.
- Idempoten: tandai/lock baris sebelum kirim supaya tidak terkirim dua kali walau loop tumpang tindih.
- Setelah restart: pengingat yang terlewat dikirim sekali dengan keterangan telat ("telat 12 menit"). Pengingat berulang menghitung kemunculan berikutnya **setelah sekarang**, bukan mengirim semua yang terlewat.
- Pesan terkirim punya tombol inline: **Tunda 10 menit**, **Tunda 1 jam**, **Selesai**. `callback_data` maksimal 64 byte, jadi pakai format pendek seperti `rem:snooze10:<id>`.
- Kalau Telegram membalas 403 (user memblokir bot) atau chat tidak ditemukan: tandai `failed`, hentikan pengingat user itu, jangan retry tanpa henti.
- Teks pengingat saat tiba memakai `persona.strings.reminderFired` (contoh: "Hei bodoh, waktunya: {teks}. B-bukan berarti aku peduli ya!"). Opsional lewat flag `REMINDER_LLM_FLAVOR=1`: minta LLM menulis ulang bernada Mika, dengan fallback ke template kalau gagal atau lambat.

**Data**
```
reminders(id INTEGER PK, chat_id, user_id, text, due_at INTEGER, tz TEXT,
          repeat TEXT NULL, status TEXT, created_at, last_sent_at, snooze_count)
```
`status`: `pending | sent | cancelled | failed`. `repeat`: bentuk teks terstruktur yang diparse ulang (contoh `daily`, `weekly:1,3`, `monthly:1`, `every:7200`).

**Edge case yang wajib ditangani**
- Waktu di masa lalu (toleransi 60 detik): tolak dengan pesan jelas.
- "17:30" saat sekarang sudah lewat 17:30: artinya besok, dan konfirmasi harus menyebut tanggalnya.
- Batas maksimal pengingat aktif per user (default 50) dan teks maksimal 500 karakter.
- Pergantian zona waktu user setelah pengingat dibuat tidak boleh menggeser pengingat yang sudah ada (waktu absolut tetap).
- Waktu yang ambigu karena DST tidak relevan di Indonesia, tapi parser tidak boleh crash untuk zona lain.

**Selesai jika:** pengingat tetap terkirim setelah bot di-restart, tidak pernah terkirim ganda, pengingat berulang jalan beberapa putaran, tombol tunda dan selesai bekerja, parser waktu punya tes (minimal 25 kasus termasuk kasus aneh), dan fitur tetap jalan saat API LLM dimatikan (jalur `/remind`).

## F-11 To-do list
- `/todo <teks>` tambah, `/todo` atau `/list` tampilkan, `/done <nomor>` selesai, `/deltodo <nomor>`. Tampilan daftar punya tombol centang per item (inline).
- Opsional `due` per item: `/todo beli beras @besok` otomatis membuat pengingat lewat F-10.
- Tag natural: `[TODO_ADD: teks]`, `[TODO_DONE: nomor atau kata kunci]` (cocokkan kata kunci secara fuzzy sederhana, dan kalau lebih dari satu kecocokan, minta user memilih).
- Data: `todos(id, user_id, text, done, due_at, created_at, done_at)`.
- **Selesai jika:** daftar tetap ada setelah restart dan nomor tampilan konsisten (nomor per user, bukan id global).

## F-12 Catatan
- `/note <teks>` simpan, `/notes` daftar (paginasi 10 per halaman dengan tombol), `/note <id>` lihat, `/delnote <id>`, `/findnote <kata>` cari (pakai SQLite FTS5 atau `LIKE`).
- Dukung label: `/note #ide #kerja teks`.
- Tag natural: `[NOTE: teks]` ("catat ya, wifi rumah ...").
- Peringatan di README: catatan disimpan tidak terenkripsi di `data/bot.db`.
- Data: `notes(id, user_id, text, tags, created_at)`.

## F-13 Pesan pagi dan malam terjadwal
- `/morning 07:00`, `/night 22:30` mengatur waktu (zona waktu user), `/morning off` mematikan.
- Pesan pagi: sapaan in-character plus ringkasan hari: pengingat hari ini, to-do yang belum selesai, dan (kalau F-40 aktif dan kota diatur) cuaca. Pesan malam: ringkasan yang selesai dan ajakan check-in (hubungkan ke F-24 kalau aktif).
- Gunakan scheduler yang sama dengan F-10 (tabel `schedules` generik: jenis, jam, hari aktif, `last_run_date` untuk mencegah dobel).
- Template tetap dari `persona.strings`, dengan variasi acak beberapa kalimat. LLM hanya opsional.
- **Selesai jika:** pesan terkirim sekali per hari pada jam yang diatur, termasuk setelah restart.

## F-14 Memori jangka panjang + ringkasan percakapan
- **Ringkasan riwayat:** kalau riwayat melewati batas token/jumlah pesan, ringkas bagian lama lewat LLM jadi paragraf pendek, simpan di tabel `summaries(chat_id, text, updated_at)`, dan sisipkan di prompt sebagai konteks.
- **Fakta tentang user:** setiap N pesan (default 20), minta LLM mengekstrak fakta stabil (nama panggilan, hobi, jadwal tetap, preferensi) sebagai JSON daftar kalimat pendek. Simpan di `user_facts(id, user_id, fact, created_at)` dengan deduplikasi.
- Sisipkan maksimal ~15 fakta paling relevan/terbaru ke system prompt ("Hal yang kamu ketahui tentang user: ...").
- `/memory` menampilkan semua fakta yang tersimpan beserta tombol hapus per fakta. `/forget` menghapus riwayat dan, dengan konfirmasi, juga fakta.
- Jangan simpan data sensitif (kesehatan, finansial detail, kata sandi, identitas) kecuali user memintanya secara eksplisit. Tambahkan aturan ini ke prompt ekstraksi.
- **Selesai jika:** Mika ingat hal yang disebut user beberapa hari lalu, dan user bisa melihat serta menghapus apa yang diingat.

## F-15 Ganti persona + persona custom
- `/persona` menampilkan daftar persona dengan tombol. Pilihan tersimpan per chat (di grup hanya admin grup).
- Tambahkan minimal 3 persona baru selain tsundere, masing-masing dengan `strings` lengkap dan contoh dialog: mis. **kalem/kakak senior**, **ceria/penyemangat**, **sarkas/deadpan**.
- `/persona custom <deskripsi>`: user menulis deskripsi singkat, bot membungkusnya dengan template aman (aturan format, aturan GIF, aturan keselamatan F-05 yang tidak bisa dihapus) lalu menyimpannya per user.
- Persona custom tidak boleh menimpa aturan keselamatan. Batasi panjang deskripsi (mis. 800 karakter).
- **Selesai jika:** ganti persona langsung berlaku di pesan berikutnya dan semua fitur lain memakai `strings` persona aktif.

---

# COMPANION DAN HIBURAN

## F-20 Sistem affinity (level "dere")
- Poin kedekatan per user: naik pelan lewat interaksi (batas harian supaya tidak bisa di-farm), turun sangat pelan kalau lama tidak ngobrol. Contoh level: 0 "Jutek banget", 1 "Gengsian", 2 "Mulai luluh", 3 "Malu-malu perhatian", 4 "Dere".
- Level aktif disisipkan ke system prompt dengan penjelasan nada tiap level (tsundere makin lembut di level tinggi tapi tetap gengsi).
- `/status` menampilkan level dan progres dengan gaya Mika.
- **Batasan desain (wajib):** tidak ada manipulasi emosi supaya user terus chat. Mika tidak boleh membuat user merasa bersalah karena pergi, tidak ada penalti berlebihan, dan poin tidak menghalangi fitur apa pun.
- Data: `affinity(user_id, points, level, last_gain_date, gained_today)`.

## F-21 Stiker
- Handler `message:sticker`: kalau pengirim adalah admin dalam mode `/addsticker <mood>`, simpan `file_id` ke tabel `stickers(file_id, mood)`.
- Tag `[STICKER: mood]` (mood dari daftar tetap: senang, kesal, malu, sedih, bingung, ...). Bot memilih stiker acak dari mood itu dan mengirim `sendSticker`. Kalau tidak ada stiker untuk mood itu, diam saja (tidak error).
- Frekuensi diatur lewat prompt dan setelan F-02 (jangan bersamaan dengan GIF di balasan yang sama).
- Saat user mengirim stiker, kirim emoji stiker + nama set ke LLM sebagai teks ("[user mengirim stiker 😳]") supaya Mika bisa bereaksi.
- Catatan: `file_id` bersifat spesifik per bot, jadi stiker harus dikumpulkan lewat bot ini sendiri.

## F-22 Mika chat duluan (proaktif)
- **Opt-in** lewat `/proactive on|off`, default mati.
- Aturan: maksimal 1 pesan per hari per user, jam tenang default 22:00 sampai 07:00 (atur lewat `/quiet 22:00-07:00`), hanya ke user yang pernah `/start` dan tidak memblokir bot, dan hanya kalau user tidak aktif lebih dari X jam (default 8).
- Isi pesan: sapaan singkat in-character yang merujuk fakta dari F-14 atau pengingat/to-do (kalau ada), bukan spam acak.
- Berhenti otomatis kalau user tidak membalas 3 pesan proaktif berturut-turut.
- **Selesai jika:** pesan hanya muncul dalam batas aturan, bisa dimatikan kapan saja, dan tidak pernah terkirim di jam tenang.

## F-23 Game kecil
- Semua lewat inline keyboard dan permainan satu chat sekali jalan:
  - `/suit` (gunting-batu-kertas lawan Mika, dengan komentar in-character)
  - `/tebak` (tebak angka 1 sampai 100, jumlah percobaan dibatasi)
  - `/quiz` (soal pilihan ganda dari bank soal JSON lokal `data/quiz.json`; LLM opsional untuk membuat soal, wajib divalidasi bentuknya)
  - `/truth` dan `/dare` (bank kalimat per persona di `persona.strings`)
  - `/pilih a, b, c` (Mika memilihkan satu), `/dadu`, `/koin`
- Skor sederhana per user (`game_scores`). `/skor` menampilkan papan skor chat.
- Hasil acak harus dihitung di kode, **bukan** oleh LLM.

## F-24 Mood check-in dan jurnal
- `/mood` menampilkan skala 1 sampai 5 (inline) plus teks opsional. Tersimpan di `moods(user_id, score, note, created_at)`.
- Check-in malam opsional (hubungkan ke F-13). `/moodweek` menampilkan ringkasan 7 hari (teks, atau grafik sederhana kalau ada ide yang ringan, tanpa menambah dependensi berat).
- Mika boleh memberi respons suportif, tapi fitur ini **bukan terapi** dan tidak memberi diagnosis. Tulis catatan ini di README dan di `/mood`. Aturan krisis F-05 tetap berlaku di sini.
- Data jurnal hanya bisa dilihat user sendiri, tidak masuk ke fitur grup atau statistik admin dalam bentuk isi.

---

# MEDIA

## F-30 Baca gambar (vision)
- Handler `message:photo`: ambil ukuran terbesar yang masih wajar (batasi sisi panjang dan ukuran file, bot hanya bisa mengunduh sampai 20 MB), unduh lewat `getFile`, ubah ke base64.
- Kirim ke LLM dengan format pesan OpenAI: `content: [{type:'text', text: caption}, {type:'image_url', image_url:{url:'data:image/jpeg;base64,...'}}]`. Gambar **tidak** disimpan di riwayat (simpan hanya placeholder teks "[user mengirim foto: ...]" plus balasan).
- Model khusus lewat `LLM_VISION_MODEL`. Kalau model/gateway tidak mendukung gambar (error 400/422), balas in-character bahwa Mika tidak bisa melihat gambar, jangan crash.
- **Tanya dulu ke user sebelum mulai:** daftar model di gateway yang mendukung input gambar. Jangan menebak dari nama model.

## F-31 Voice note (STT/TTS)
- **Syarat:** hanya dikerjakan kalau gateway menyediakan endpoint transkripsi (`/audio/transcriptions`) dan/atau TTS (`/audio/speech`). Cek dokumentasi gateway atau tanya user. Kalau tidak ada, laporkan dan lewati fitur ini.
- STT: handler `message:voice` (format OGG/Opus), unduh, kirim ke endpoint transkripsi, perlakukan hasilnya sebagai pesan teks biasa, dan tampilkan "Kudengar: ..." supaya user tahu hasilnya.
- TTS (opsional): `/voice on|off`. Kalau aktif, balasan pendek dikirim sebagai voice note (`sendVoice`) selain teks. Batasi panjang agar hemat biaya.
- Batas durasi voice masuk (mis. 60 detik).

---

# UTILITAS

## F-40 Cuaca
- `/cuaca <kota>` dan `/cuaca` (memakai kota tersimpan lewat `/kota <nama>`).
- Sumber: Open-Meteo (gratis, tanpa API key) dengan endpoint geocoding-nya untuk mengubah nama kota jadi koordinat. Cek dokumentasi resmi Open-Meteo untuk parameter terbaru sebelum menulis kodenya.
- Tampilkan suhu, kondisi, peluang hujan, dan saran satu kalimat in-character ("bawa payung, bodoh").
- Cache hasil beberapa menit per kota. Timeout 8 detik, dan kalau gagal balas error ramah.
- Tag natural opsional: `[WEATHER: kota]`, dijalankan bot lalu hasilnya ditambahkan ke balasan.

## F-41 Jadwal sholat
- `/sholat` dan `/sholat <kota>` menampilkan 5 waktu sholat hari ini. `/adzan on|off` mengirim pengingat otomatis (pakai scheduler F-10) sekian menit sebelum waktu masuk.
- Sumber yang disarankan: API Aladhan (gratis). **Pilih metode perhitungan yang sesuai Kemenag RI** dan cek dokumentasi resmi untuk nilai parameternya, jangan menebak angka metode.
- Cache per kota per hari, dan hitung ulang pengingat setiap hari.
- Fitur ini opsional per user dan netral (tanpa komentar persona yang berlebihan).

## F-42 Kurs, kalkulator, konversi
- `/kurs 100 usd idr`: pakai API kurs gratis tanpa key (mis. `open.er-api.com`, cek ketersediaan dan batasnya dulu), cache 1 jam, tampilkan waktu pembaruan.
- `/hitung <ekspresi>`: evaluasi aritmetika dengan parser aman buatan sendiri (angka, + - * / ^ %, kurung). **Dilarang memakai `eval` atau `Function`.**
- `/konversi 5 km mil`: tabel konversi satuan kecil di kode (panjang, berat, suhu, volume).
- Semua angka dihitung di kode, bukan oleh LLM.

## F-43 Timer dan pomodoro
- `/timer 25m nama` menghitung mundur sebagai pengingat sekali jalan (pakai F-10 secara internal).
- `/pomodoro` menjalankan siklus 25/5 dengan pesan di tiap pergantian (jumlah siklus dan durasi bisa diatur). `/stop` menghentikan.
- Tahan restart (semuanya lewat tabel yang sama dengan pengingat).

## F-44 Habit tracker dan streak
- `/habit add <nama> [jam]` membuat kebiasaan harian. Pada jamnya, bot mengirim pesan dengan tombol **Sudah** / **Lewat**.
- `/habits` menampilkan daftar dengan streak saat ini dan streak terpanjang. Streak putus kalau satu hari terlewat (hitung di zona waktu user).
- Pesan streak merayakan secara in-character (tanpa mengejek habis-habisan saat user gagal).
- Data: `habits(id, user_id, name, remind_time, created_at)`, `habit_logs(habit_id, date, status)`.

## F-45 Catat pengeluaran
- `/catat 25000 makan siang` (juga `25k`, `1,5jt`). Kategori otomatis lewat kata kunci sederhana, dengan tombol untuk mengoreksi kategori.
- `/rekap` (hari ini), `/rekap minggu`, `/rekap bulan` menampilkan total dan rincian per kategori. `/hapuscatat <id>`.
- `/exportcsv` mengirim file CSV pengeluaran user (pakai `sendDocument`).
- Tag natural: `[EXPENSE: nominal | kategori | keterangan]` ("tadi beli bensin 30 ribu").
- Parser nominal harus punya tes (`25k`, `25rb`, `25.000`, `1,5jt`, `1.5 juta`).
- Data: `expenses(id, user_id, amount, category, note, created_at)`. Simpan nominal sebagai integer rupiah.

## F-46 Terjemah dan rangkum teks
- `/terjemah <bahasa> <teks>` atau balas (reply) pesan dengan `/terjemah en`.
- `/rangkum` sambil me-reply pesan panjang atau teks yang ditempel menghasilkan ringkasan beberapa poin.
- Tidak mengambil isi URL otomatis (menghindari SSRF dan konten berbahaya). Kalau nanti diminta, buat fitur terpisah dengan allowlist dan batas ukuran.
- Pakai prompt khusus tugas yang netral (bukan persona), lalu bungkus hasilnya dengan satu kalimat Mika.

---

# GRUP

## F-50 Fitur grup
- Persona per grup (`/persona` hanya untuk admin grup, cek lewat `getChatMember`).
- `/rangkum_grup [jumlah]` merangkum N pesan terakhir. **Syarat:** bot hanya bisa membaca pesan grup kalau privacy mode dimatikan di BotFather atau bot dijadikan admin. Dokumentasikan ini. Simpan log pesan grup secara terbatas (mis. 200 pesan terakhir, dihapus otomatis) dan beri tahu di `/start` grup bahwa log ini ada.
- Pengingat grup: `/remind` di grup mengirim ke grup dan menyebut pembuatnya.
- Sapaan anggota baru (opsional, bisa dimatikan admin).
- Kenali pengirim: prefiks nama sudah ada di `index.js`, pertahankan dan sertakan username bila perlu.
- Bot tidak membalas semua pesan: tetap hanya saat di-mention atau di-reply, kecuali admin mengaktifkan `/chatty on` dengan peluang membalas kecil (mis. 5%) dan cooldown.

---

# OPERASIONAL

## F-60 Perintah admin
- Hanya untuk `ADMIN_IDS`: `/stats` (jumlah user aktif, pesan hari ini, pemakaian token bila ada, jumlah pengingat aktif), `/ban <id>` dan `/unban <id>`, `/broadcast <teks>` (dengan konfirmasi dan jeda antar kirim supaya tidak kena limit Telegram), `/model <nama>` mengganti model sementara tanpa restart, `/maintenance on|off`.
- Semua tindakan admin dicatat di tabel `admin_log`.

## F-61 Ekspor dan hapus data
- `/export` mengirim file JSON berisi data user (setelan, catatan, to-do, pengingat, fakta, pengeluaran, mood). `/deleteme` menghapus semua data user setelah konfirmasi dua langkah.
- Tambahkan kebijakan data singkat di README dan `/privacy`.

## F-62 Deploy
- `Dockerfile` (Node 22 slim) + `docker-compose.yml` dengan volume untuk `data/`, serta `ecosystem.config.cjs` untuk PM2 sebagai alternatif.
- Shutdown yang rapi: hentikan scheduler, selesaikan kirim yang berjalan, `bot.stop()`, tutup DB.
- Endpoint health check sederhana (HTTP kecil, opsional lewat env) untuk monitoring.
- Mode webhook opsional (`WEBHOOK_URL`, `WEBHOOK_SECRET`) dengan fallback ke long polling.
- Panduan deploy singkat ke VPS di README, dan ingatkan mencadangkan `data/bot.db` secara berkala (sertakan skrip backup sederhana).

## F-63 Tes otomatis
- `npm test` menjalankan `node --test`. Cakupan minimum: parser tag aksi, parser waktu dan ulang pengingat, logika scheduler (dengan jam palsu yang bisa dimajukan), parser nominal, kalkulator aman, limiter, dan migrasi DB (database in-memory).
- Mock LLM lewat server HTTP lokal kecil atau fungsi yang bisa disuntik (lihat pola tes `llm.js`).
- (Opsional) workflow GitHub Actions yang menjalankan tes di Node 20 dan 22.

## F-64 Logging dan pemakaian token
- Logger sederhana dengan level (`LOG_LEVEL`), format satu baris, tanpa data sensitif.
- Catat `usage` dari respons LLM (prompt_tokens, completion_tokens) per user per hari di tabel `usage`. Tampilkan di `/stats` dan beri peringatan ke admin kalau melewati batas harian yang diatur.
- Catat latensi tiap panggilan LLM dan model mana yang akhirnya dipakai (utama atau cadangan).

---

## Definisi selesai (berlaku untuk semua fitur)

- [x] Fitur bisa dimatikan lewat `FEATURES` dan tidak memengaruhi fitur lain.
- [x] Ada perintah slash yang jalan tanpa LLM (kalau fiturnya memang bukan soal LLM).
- [x] Tes `node --test` lulus, termasuk tes baru untuk logika inti fitur.
- [x] `README.md` dan `.env.example` diperbarui.
- [x] Tidak ada API key/token di kode atau log.
- [x] Sudah dicoba manual di Telegram untuk jalur normal dan satu jalur gagal (mis. LLM mati atau input salah).
- [x] Checklist progres di atas sudah dicentang dan ringkasan perubahan dilaporkan.
