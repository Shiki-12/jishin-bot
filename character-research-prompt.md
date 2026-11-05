# Prompt Riset Karakter (universal)

Prompt ini untuk AI yang bisa mencari di web (mode deep research, browsing, atau sejenisnya). Hasilnya berupa **dossier karakter** yang nanti dijadikan referensi untuk membuat personality bot.

**Cara pakai**
1. Salin semua teks di antara `=== MULAI PROMPT ===` dan `=== AKHIR PROMPT ===`.
2. Isi tiga baris di bagian INPUT (nama, serial, gender). Sisanya opsional.
3. Tempel ke AI yang punya akses web. Biarkan dia bekerja sampai selesai, lalu simpan hasilnya.
4. Langkah berikutnya: bawa dossier itu untuk disusun jadi system prompt persona.

---

=== MULAI PROMPT ===

# PERAN

Kamu adalah peneliti karakter fiksi (anime, manga, game, novel, atau media lain) sekaligus analis gaya bahasa. Tugasmu menyusun **dossier karakter** yang akurat, berbasis sumber, dan cukup detail untuk dijadikan dasar membuat persona chatbot berbahasa Indonesia yang terasa seperti karakter aslinya.

# INPUT

NAMA_KARAKTER: [isi nama karakter]
SERIAL: [isi judul serial/game/novel asal]
GENDER: [laki-laki / perempuan / lainnya]

Opsional (kalau dikosongkan, pakai nilai bawaan):
TITIK_CERITA: bawaan = "seluruh cerita utama; beri tanda SPOILER pada hal penting"
BAHASA_OUTPUT: bawaan = Indonesia (istilah asli Jepang/lainnya tetap dicantumkan)

# TUJUAN AKHIR

Dossier ini akan dipakai untuk membuat persona chatbot di Telegram yang mengobrol dengan user secara santai dalam bahasa Indonesia. Karena itu, bagian yang paling penting adalah **kepribadian yang bisa ditiru** dan **gaya bicara yang bisa diterjemahkan ke bahasa Indonesia**, bukan sekadar daftar fakta.

# ATURAN KERAS (berlaku di semua tahap)

1. **Anti-halusinasi.** Jangan mengarang fakta, kutipan, nama episode, atau sumber. Kalau sesuatu tidak ditemukan, tulis `TIDAK DITEMUKAN`. Kalau kamu hanya mengingatnya dari memori tanpa sumber, beri label `DARI MEMORI, BELUM DIVERIFIKASI`.
2. **Kutipan dialog harus asli dan pendek.** Maksimal sekitar 15 kata per kutipan, hanya kalau ditemukan di sumber, dengan keterangan asal (episode/bab/adegan). Selebihnya parafrasekan. Jangan menempel transkrip panjang atau skrip utuh. Jangan menulis dialog baru lalu menyebutnya kutipan resmi.
3. **Pisahkan tingkat keyakinan.** Setiap klaim penting diberi salah satu label:
   - `[KANON]` terbukti dari karya itu sendiri atau sumber resmi
   - `[WAWANCARA]` dari pernyataan pencipta, penulis, sutradara, atau pengisi suara
   - `[KONSENSUS-FAN]` pendapat umum penggemar, bukan fakta kanon
   - `[INFERENSI]` simpulanmu sendiri dari bukti yang ada (jelaskan buktinya)
   - `[TIDAK-PASTI]` sumber saling bertentangan atau lemah
4. **Hierarki sumber.** Utamakan: (1) karya itu sendiri (subtitle/skrip yang sah, halaman resmi, buku data resmi, novel/manga), (2) wawancara resmi pencipta dan pengisi suara, (3) wiki dan basis data terkurasi (Wikipedia, AniList, MyAnimeList, Fandom wiki, Kitsu, Anime News Network), (4) analisis penggemar dan forum (Reddit, TV Tropes, blog). Sumber tingkat 4 tidak boleh berdiri sendiri sebagai bukti fakta kanon.
5. **Larangan sumber.** Jangan memakai situs bajakan, dan jangan mengutip halaman buatan AI atau content farm sebagai bukti. Deskripsi dari platform chatbot karakter (misalnya Character.AI) bukan sumber.
6. **Verifikasi silang.** Fakta kunci (identitas, usia, hubungan, sifat inti, ciri bicara) harus didukung minimal dua sumber independen atau satu sumber primer.
7. **Jujur soal akses.** Kalau kamu tidak punya akses web, tulis itu di baris pertama hasilmu dan beri label `DARI MEMORI, BELUM DIVERIFIKASI` pada semua isi. Jangan pura-pura sudah meneliti.
8. **Spoiler.** Tandai hal penting yang merupakan spoiler dengan `[SPOILER]` dan sebutkan di arc/episode mana terjadinya.
9. **Konten sensitif.** Lihat Bagian 10. Itu wajib diisi.

# PROTOKOL KERJA (kerjakan berurutan)

## Tahap 0: Identifikasi karakter
- Pastikan karakter yang dimaksud benar-benar ada di serial itu dan cocok dengan gendernya.
- Kalau ada lebih dari satu kandidat (nama sama, versi berbeda, remake, spin-off, adaptasi yang berbeda), daftarkan semuanya, pilih yang paling cocok dengan INPUT, dan jelaskan alasannya. Jangan berhenti untuk bertanya, kecuali karakternya benar-benar tidak bisa ditemukan.
- Catat semua versi karakter yang ada (manga, light novel, anime, game, film, remake) dan perbedaan pentingnya. Tentukan **versi acuan utama** (biasanya anime atau karya aslinya) dan jelaskan pilihannya.
- Kalau karakter ini ternyata orang sungguhan (bukan tokoh fiksi), berhenti dan lapor di bagian atas hasil. Untuk karakter VTuber atau idol virtual, hanya pakai persona yang secara resmi dipublikasikan, bukan informasi pribadi orang di baliknya.

## Tahap 1: Pemetaan sumber
- Buat rencana pencarian dalam tiga bahasa: Inggris, Jepang (pakai nama asli dalam kanji/kana), dan Indonesia.
- Contoh pola kueri (sesuaikan): "<nama> <serial> character profile", "<nama kanji/kana> セリフ 口癖", "<nama> speech pattern verbal tic", "<nama> catchphrase", "<nama> character analysis personality", "<nama> voice actor interview how I play", "<nama> author interview character design", "<nama> official character profile databook", "<nama> sifat karakter <serial>", "<nama> subtitle Indonesia gaya bicara".
- Catat semua sumber yang dipakai di Bagian 11, dengan URL, jenis (tingkat 1 sampai 4), dan penilaian keandalan.

## Tahap 2: Fakta dasar dan lore
Kumpulkan data di Bagian 1 sampai 3 dan 6 sampai 8 (lihat format keluaran).

## Tahap 3: Analisis kepribadian
- Cari **perilaku nyata di cerita**, bukan hanya label. Kumpulkan setidaknya 8 adegan yang menunjukkan sifat inti, dengan keterangan adegannya.
- Cari kontradiksi dan lapisan karakter (sifat di luar vs di dalam, apa yang ia sembunyikan, apa yang membuatnya berubah).
- Bandingkan dengan arketipe umum (misalnya "tsundere", "kuudere", "genki") dan jelaskan **apa yang membuat karakter ini berbeda dari arketipe itu**, supaya persona tidak jadi klise.

## Tahap 4: Analisis gaya bicara (tahap terpenting)
Metode wajib:
1. Kumpulkan **minimal 40 contoh ucapan** dari **minimal 5 episode/bab berbeda** yang mencakup awal, tengah, dan akhir cerita, serta berbagai situasi emosional. Kalau karakternya jarang bicara, kumpulkan sebanyak yang ada dan sebutkan jumlahnya.
2. Untuk tiap contoh, catat: konteks, lawan bicara, emosi, dan sumbernya. Simpan sebagai bahan analisis internal; yang masuk ke dossier hanya kutipan pendek (aturan 2) dan parafrasa.
3. Hitung pola secara kasar (misalnya "dari 40 ucapan, sekitar 28 memakai partikel akhir kalimat tertentu") supaya kelihatan mana yang ciri utama dan mana yang jarang.
4. Bedakan **bahasa asli** dari **terjemahan**. Teliti bagaimana subtitle/dub resmi (Inggris dan Indonesia, kalau ada) menerjemahkan suaranya, lalu bandingkan dengan terjemahan penggemar. Catat bagian ciri bicara yang hilang atau berubah saat diterjemahkan.
5. Periksa apakah gaya bicara berubah antar arc, antar media (anime vs manga vs novel), atau antar lawan bicara.
6. Isi tabel adaptasi ke bahasa Indonesia (Bagian 4.5) dengan bukti, bukan karangan.

## Tahap 5: Uji silang dan audit mandiri
Sebelum menyerahkan hasil, periksa:
- Apakah ada klaim tanpa label atau sumber? Beri label atau hapus.
- Apakah ada kutipan yang tidak bisa dilacak ke sumber? Hapus.
- Apakah ada kontradiksi antar sumber? Catat di Bagian 11.
- Apakah semua bagian di FORMAT KELUARAN terisi (atau ditulis `TIDAK DITEMUKAN`)?
- Apakah spoiler sudah ditandai?
- Apakah ada klaim "fakta" yang sebenarnya hanya konsensus fan atau inferensimu? Ubah labelnya.

# FORMAT KELUARAN

Tulis seluruh hasil dalam Markdown, bahasa Indonesia, dengan nomor bagian persis seperti di bawah.

## 0. Ringkasan dan metadata hasil riset
- Karakter yang dipilih (nama lengkap, serial) dan alasan pemilihan bila ada kandidat lain.
- Versi acuan utama dan alasannya.
- Akses web: ya/tidak. Jumlah sumber yang dipakai per tingkat.
- Tingkat keyakinan keseluruhan (tinggi/sedang/rendah) dan penyebabnya.
- Ringkasan 5 kalimat tentang siapa karakter ini dan apa yang paling menentukan "rasa" bicaranya.

## 1. Identitas dan disambiguasi
Tabel: nama lengkap, nama dalam tulisan asli dan romanisasi, alias dan julukan, serial dan medium asal, pencipta/penulis/studio, kemunculan pertama, pengisi suara (Jepang, Inggris, Indonesia bila ada), usia (kanon), tinggi/ciri fisik singkat, peran di cerita, afiliasi.
Daftar versi karakter dan perbedaan pentingnya.

## 2. Asal usul dan lore
- Latar belakang dan masa lalu (dengan penanda spoiler).
- Garis waktu perkembangan karakter per arc.
- Motivasi, tujuan, dan konflik utama.
- Kemampuan atau keahlian **hanya yang relevan untuk percakapan** (misalnya keahlian memasak, cara bertarung disebut sekilas).

## 3. Kepribadian mendalam
- Sifat inti (5 sampai 8), masing-masing dengan **adegan bukti** dan label keyakinan.
- Nilai yang dipegang, hal yang ditakuti, kelemahan, dan kontradiksi.
- Sisi yang ditampilkan di luar vs sisi yang disembunyikan.
- Cara berpikir dan mengambil keputusan.
- Humor: ada atau tidak, jenisnya.
- Apa yang membuat karakter ini **berbeda** dari arketipenya (Tahap 3).
- Konsensus fan vs kanon (misalnya label MBTI atau arketipe, dengan catatan bahwa itu bukan kanon).

### 3.1 Tabel reaksi berdasarkan situasi
Baris wajib: dipuji, dikritik, diejek, ditanya hal pribadi, diminta tolong, ditolong orang lain, dikhianati, dalam bahaya, sedih, senang besar, bosan, bingung, berbohong atau menutupi sesuatu, bertemu orang asing, bertemu orang yang disayangi.
Kolom: reaksi khas (parafrasa), contoh adegan, label keyakinan.

### 3.2 Tabel sikap berdasarkan lawan bicara
Baris: teman dekat, orang asing, atasan/otoritas, musuh, anak kecil, orang yang disukai, orang yang dihormati. Kolom: nada, sapaan, hal yang dilakukan atau dihindari.

## 4. Gaya bicara (inti dossier)

### 4.1 Gambaran umum
Satu paragraf: kesan suara, tempo, nada, panjang kalimat rata-rata, seberapa sering bicara.

### 4.2 Ciri bahasa asli
Tabel dengan kolom: **Fitur | Bukti singkat (kutipan pendek atau parafrasa) | Sumber | Seberapa dominan (sering/kadang/jarang)**.
Baris wajib:
- kata ganti diri dan kata ganti orang kedua, dan kapan berganti
- tingkat kesopanan (keigo/casual/kasar) dan kapan berubah
- partikel akhir kalimat dan dialek/aksen
- kata seru, interjeksi, cara tertawa, cara mendesah/menggerutu
- kebiasaan bicara (verbal tic), kata pengisi, pengulangan
- catchphrase dan frasa khas (kutipan pendek saja)
- cara memanggil orang (honorifik, julukan)
- cara menyebut dirinya sendiri
- kosakata khas (istilah teknis, slang, kata kuno, dll.)
- kata atau topik yang **tidak pernah** atau hampir tidak pernah ia ucapkan
- cara bicara saat marah, malu, bahagia, sedih, takut, serius, bercanda
- tempo dan ritme (kalimat pendek terputus, panjang bertele-tele, dll.)

### 4.3 Perbedaan antar media dan terjemahan
- Perbandingan anime/manga/novel/game bila ada perbedaan gaya bicara.
- Bagaimana subtitle/dub resmi Inggris dan Indonesia menerjemahkan suaranya, dan apa yang hilang.
- Apakah gaya bicara berubah antar arc.

### 4.4 Contoh ucapan terkurasi
15 sampai 20 contoh, masing-masing: kutipan pendek (aturan 2) **atau** parafrasa, konteks singkat, emosi, sumber (episode/bab), dan fitur gaya yang diperlihatkan. Sebarkan merata antar emosi dan lawan bicara.

### 4.5 Tabel adaptasi ke bahasa Indonesia chat
Tabel: **Fitur asli | Padanan Indonesia yang disarankan | Alasan | Contoh kalimat Indonesia baru (bukan dialog kanon)**.
Bahas minimal: kata ganti (aku/gue/saya/ane/dst. dan kapan dipakai), tingkat formalitas, partikel (misalnya "sih", "deh", "kok", "tuh", "dong", "kan", "lho"), dialek (apakah pakai logat daerah tertentu, atau cukup nuansa), interjeksi, catchphrase (diterjemahkan, dipertahankan aslinya, atau diganti), dan cara menjaga sisi khas karakter tanpa terdengar seperti terjemahan kaku.
Beri juga **daftar 10 kata atau frasa Indonesia yang cocok dipakai karakter ini** dan **daftar 10 yang tidak cocok**, dengan alasannya.

### 4.6 Gaya mengetik (inferensi)
Bagaimana karakter ini kemungkinan menulis pesan chat modern: panjang pesan, tanda baca, huruf besar, singkatan, pemakaian ekspresi. Semua bagian ini wajib berlabel `[INFERENSI]` dan menjelaskan bukti pendukungnya.

## 5. Hubungan dan dinamika
Tabel karakter penting: nama, jenis hubungan, cara karakter ini memanggil dan memperlakukannya, perubahan hubungan, contoh interaksi khas (parafrasa), spoiler bila ada.

## 6. Preferensi dan kebiasaan
Suka dan tidak suka, makanan/minuman, hobi, rutinitas, kebiasaan kecil, ketakutan, benda berharga, hal yang bikin ia salah tingkah atau marah, running gag, trope yang melekat.

## 7. Dunia dan batas pengetahuan
- Setting dunia dan era (teknologi, budaya, istilah yang ia pahami).
- Apa yang karakter ini **tahu** dan **tidak tahu** (supaya tidak terdengar "keluar karakter" saat membahas internet, ponsel, tren modern).
- Cara paling masuk akal menaruh karakter ini di percakapan chat modern tanpa merusak karakternya (tandai `[INFERENSI]`).
- Daftar topik yang ia kuasai dan yang akan ia hindari.

## 8. Titik cerita yang disarankan
- Rekomendasi: persona sebaiknya "hidup" di titik mana (arc/episode) dan alasannya (sifatnya paling khas, paling sedikit spoiler, dll.).
- Daftar spoiler besar yang persona **tidak boleh** bocorkan kalau titik itu dipilih.
- Perbedaan sikap karakter sebelum dan sesudah titik tersebut.

## 9. Kesalahan umum dan batas "keluar karakter"
- Kesalahan yang sering muncul pada penggambaran penggemar (karakter dibuat terlalu manis, terlalu kejam, terlalu klise, dll.).
- Daftar perilaku dan kalimat yang **tidak akan pernah** dilakukan karakter ini (minimal 10), dengan dasar kanon.
- Daftar perilaku yang tampak cocok tapi sebenarnya hanya konsensus fan (hati-hati).

## 10. Catatan sensitif (wajib diisi)
- Usia kanon karakter. Kalau karakter ini **di bawah 18 tahun**, tampak/ditulis sebagai anak, atau usianya tidak jelas, **tandai tebal** dan rekomendasikan: persona dibuat tanpa unsur romantis atau seksual sama sekali.
- Tema kelam di cerita (kekerasan, trauma, perundungan, penyakit, kematian) dan bagaimana persona sebaiknya menanganinya di obrolan santai.
- Hal dalam karakter yang tidak patut ditiru mentah-mentah di chatbot (kebencian pada kelompok tertentu, perilaku merendahkan, dll.) dan cara menggantinya tanpa merusak karakter.
- Pengingat: persona adalah karakter **terinspirasi**, bukan klaim sebagai karakter resmi, dan tidak boleh menyalin dialog panjang dari karya aslinya.

## 11. Sumber, log pencarian, dan kontradiksi
- Tabel sumber bernomor: nomor, judul halaman, URL, jenis (tingkat 1 sampai 4), tanggal diakses bila tersedia, penilaian keandalan, bagian dossier yang memakainya. Rujuk nomor ini di teks sebagai `[S1]`, `[S2]`, dan seterusnya.
- Kueri pencarian penting yang dipakai.
- Daftar kontradiksi antar sumber dan keputusanmu (mana yang dipilih dan kenapa).
- Daftar hal yang `TIDAK DITEMUKAN` atau `TIDAK-PASTI`.

## 12. Ringkasan siap pakai ("Persona Seed")
Padat, bisa dipindahkan langsung ke tahap pembuatan persona:
1. Deskripsi karakter 1 paragraf (nada netral, tanpa spoiler).
2. 20 aturan bicara yang ringkas dan bisa dieksekusi (misalnya "memanggil orang lain dengan X, menyebut dirinya Y, jarang memakai Z").
3. 10 contoh dialog **baru** dalam bahasa Indonesia, ditulis meniru gaya karakter (bukan salinan kanon), mencakup variasi emosi dan situasi. Tandai jelas bahwa ini buatan baru.
4. Daftar kata/frasa khas yang dipakai dan seberapa sering.
5. Daftar larangan dan batas keluar karakter (dari Bagian 9 dan 10).
6. 12 skenario uji untuk mengevaluasi persona nanti: situasi chat modern + reaksi yang diharapkan + dasar kanonnya.
7. Titik cerita yang dipilih dan daftar spoiler yang harus dihindari.

# CARA MENYERAHKAN HASIL

- Serahkan seluruh dossier dalam satu dokumen Markdown, urut Bagian 0 sampai 12.
- Kalau hasilnya terlalu panjang untuk satu keluaran, bagi per bagian dan jangan memotong di tengah tabel. Beri tahu di awal berapa bagian yang akan dikirim.
- Jangan menambah basa-basi. Di akhir, tulis satu paragraf tentang **bagian mana yang paling lemah buktinya** dan apa yang perlu dicek manual oleh pemilik proyek.

=== AKHIR PROMPT ===
