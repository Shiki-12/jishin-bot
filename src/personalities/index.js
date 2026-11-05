import { tsundere } from './tsundere.js';
import { kalem } from './kalem.js';
import { ceria } from './ceria.js';
import { sarkas } from './sarkas.js';
import { getDb } from '../core/db.js';
import { GLOBAL_SAFETY_RULES } from '../core/actions.js';

const all = {
  tsundere,
  kalem,
  ceria,
  sarkas,
};

export function buildCustomPersonality({ name = 'Custom', description = '' } = {}) {
  const safeDesc = (description || '').trim().slice(0, 800);
  return {
    id: 'custom',
    name,
    greeting: `Halo! Karakter "${name}" siap menemani obrolanmu! ✨`,
    errorMessage: 'Terjadi sedikit kendala teknis pada sistem.',
    strings: {
      helpHeader: 'Daftar perintah yang tersedia:',
      helpFooter: 'Ketik perintah di atas untuk menggunakannya.',
      forgetSuccess: 'Riwayat percakapan sudah dibersihkan.',
      settingsHeader: 'Pengaturan bot:',
      settingsSaved: 'Pengaturan berhasil disimpan.',
      tzInvalid: 'Format zona waktu tidak valid.',
      tzSuccess: 'Zona waktu kamu diatur ke {tz}.',
      rateLimited: 'Tunggu sebentar sebelum mengirim pesan lagi.',
      inputTooLong: 'Pesan terlalu panjang. Mohon diringkas.',
      unauthorized: 'Akses tidak diizinkan.',
      queueFull: 'Antrian sedang penuh, mohon tunggu.',
      reminderSet: 'Pengingat dicatat pada *{time}*:\n"{text}"',
      reminderFired: 'Saatnya: *{text}*',
      reminderCancelled: 'Pengingat #{id} dibatalkan.',
      todoAdded: 'To-do dicatat: *"{text}"*',
      todoDone: 'To-do *"{text}"* selesai.',
      todoDeleted: 'To-do #{num} dihapus.',
      todoEmpty: 'Belum ada to-do.',
      todoNotFound: 'To-do tidak ditemukan.',
      noteSaved: 'Catatan disimpan (*#{id}*).',
      noteDeleted: 'Catatan #{id} dihapus.',
      noteNotFound: 'Catatan #{id} tidak ditemukan.',
      scheduleSet: 'Jadwal pesan {type} diatur jam *{time}* ({tz}).',
      scheduleOff: 'Jadwal pesan {type} dimatikan.',
      morningGreetings: ['Selamat pagi! Semoga harimu menyenangkan.'],
      morningNoReminders: 'Tidak ada pengingat hari ini.',
      morningRemindersHeader: '📋 *Jadwal hari ini:*',
      morningTodosHeader: '📝 *To-do belum selesai:*',
      morningAllTodosDone: 'Semua to-do sudah selesai.',
      nightGreetings: ['Selamat malam! Waktunya istirahat.'],
      nightTodosCompleted: 'Hari ini kamu menyelesaikan {count} to-do.',
      nightNoTodosCompleted: 'Belum ada to-do selesai hari ini.',
      nightPendingTodos: 'Masih ada {count} to-do tersisa.',
      nightCheckin: 'Gimana harimu hari ini? Istirahat yang cukup ya.',
      memoryHeader: 'Fakta yang kuingat tentangmu:',
      memoryEmpty: 'Belum ada fakta yang tersimpan.',
      factDeleted: 'Fakta #{id} dihapus.',
      factsCleared: 'Semua fakta dihapus.',
      forgetWithFactsPrompt: 'Riwayat chat dihapus. Mau hapus semua fakta juga?',
      stickersEmpty: 'Belum ada stiker yang tersimpan.',
      stickerModeActive: 'Mode tambah stiker aktif untuk mood "{mood}". Silakan kirim stiker, atau ketik /cancelsticker.',
      stickerModeCancelled: 'Mode tambah stiker dibatalkan.',
      stickerSaved: 'Stiker untuk mood "{mood}" berhasil disimpan (ID: #{id}, emoji: {emoji}).',
      proactiveEnabled: 'Fitur chat proaktif diaktifkan.',
      proactiveDisabled: 'Fitur chat proaktif dinonaktifkan.',
      quietHoursSet: 'Jam tenang diatur ke *{start}* - *{end}*.',
      quietHoursInvalid: 'Format jam tenang salah. Gunakan format: /quiet 22:00-07:00',
      proactiveGreetings: {
        withTodo: 'Halo! Jangan lupa ada to-do "{todo}" yang belum selesai ya.',
        withFact: 'Halo! Bagaimana kabarmu hari ini? Masih sibuk dengan {fact}?',
        general: [
          'Halo! Sudah cukup lama kamu tidak mengirim pesan. Semoga harimu menyenangkan.',
        ],
      },
      suitPrompt: 'Ayo main suit! Pilih salah satu:',
      suitWin: 'Selamat, kamu menang! (+3 poin)',
      suitLoss: 'Sayang sekali, kamu kalah. Coba lagi! (+0 poin)',
      suitDraw: 'Hasilnya seri! (+1 poin)',
      tebakStart: 'Tebak angka rahasia antara 1 sampai 100 dengan: /tebak <angka>',
      tebakWin: 'Selamat! Tebakanmu benar di angka *{target}*! (+3 poin)',
      tebakGameOver: 'Kesempatan habis! Angka rahasianya adalah *{target}*.',
      tebakTooHigh: 'Terlalu besar! Sisa {attempts} kesempatan.',
      tebakTooLow: 'Terlalu kecil! Sisa {attempts} kesempatan.',
      truth: [
        'Apa hal yang paling ingin kamu capai tahun ini?',
        'Siapa sosok yang paling menginspirasimu?',
      ],
      dare: [
        'Tuliskan satu target kecil yang harus kamu selesaikan hari ini!',
        'Minum segelas air putih dan regangkan tubuhmu!',
      ],
      pickChoice: 'Pilihanku adalah: *{choice}*.',
      moodFeedback: {
        low: 'Semoga besok menjadi hari yang lebih baik untukmu.',
        neutral: 'Catatan mood berhasil disimpan.',
        high: 'Senang mendengar harimu menyenangkan!',
      },
      visionUnsupported: 'Format gambar atau model saat ini belum mendukung pembacaan foto.',
      visionTooLarge: 'Ukuran foto melebihi batas maksimal (20 MB).',
      citySaved: 'Kota domisili diatur ke *{city}*.',
      cityNotFound: 'Kota "{city}" tidak ditemukan.',
      weatherError: 'Gagal mengambil data cuaca.',
      translateIntro: (lang) => `Berikut hasil terjemahan ke ${lang}:`,
      translateUrlBlocked: 'Tautan URL tidak dibuka otomatis demi keamanan. Silakan salin dan tempel teksnya secara langsung.',
      summarizeIntro: 'Berikut ringkasan poin-poin pentingnya:',
      summarizeUrlBlocked: 'Tautan URL tidak diambil otomatis demi keamanan. Silakan salin dan tempel teksnya secara langsung.',
      groupWelcome: 'Selamat datang di {group}, {name}!',
      groupSummaryIntro: 'Ringkasan {count} pesan terakhir di grup:',
      chattyEnabled: 'Mode chatty diaktifkan.',
      chattyDisabled: 'Mode chatty dinonaktifkan.',
      welcomeEnabled: 'Sapaan anggota baru diaktifkan.',
      welcomeDisabled: 'Sapaan anggota baru dinonaktifkan.',
      notGroupAdmin: 'Hanya admin grup yang dapat mengatur setelan ini.',
      notGroupChat: 'Perintah ini khusus untuk grup chat.',
      unauthorizedAdmin: 'Akses ditolak. Perintah ini hanya untuk admin bot.',
      exportDone: '📄 Berikut salinan seluruh data pribadimu yang tersimpan di bot (format JSON).',
      deleteWarning:
        '⚠️ *Peringatan Penghapusan Data Permanen!*\n\nTindakan ini akan menghapus SELURUH data pribadimu dari bot:\n• Catatan, to-do list, dan pengingat\n• Catatan pengeluaran & jurnal mood\n• Kebiasaan (habits), fakta ingatan AI, poin affinity & skor game\n• Profil dan preferensi akun\n\n_Data yang sudah dihapus TIDAK DAPAT dipulihkan. Apakah kamu yakin?_',
      deleteSuccess: '✅ *Seluruh data pribadimu telah berhasil dihapus secara permanen.*',
      deleteCancelled: '❌ *Penghapusan data telah dibatalkan.* Datamu tetap aman.',
      voiceEnabled: '🎤 Balasan pesan suara (TTS) diaktifkan.',
      voiceDisabled: '🔇 Balasan pesan suara (TTS) dinonaktifkan.',
      voiceTooLong: '⚠️ Durasi pesan suara terlalu panjang! Maksimal 60 detik.',
      voiceSttUnsupported: '⚠️ Fitur transkripsi suara (STT) belum didukung oleh gateway API saat ini. Silakan kirimkan pesan teks ya.',
      voiceHeard: '🎙️ Kudengar: *"{text}"*',
    },
    systemPrompt: `Kamu adalah asisten AI dengan kepribadian khusus yang ditentukan oleh pengguna:

## Deskripsi Karakter
${safeDesc || 'Asisten yang ramah, santun, dan selalu membantu dengan baik.'}

## Aturan Format & Respon
- Balasan santai, natural, 1-3 kalimat kecuali jika pengguna meminta penjelasan mendalam.
- Pakai paling banyak SATU penanda ekspresi per balasan, dan jangan di setiap balasan (sekitar 6 dari 10). Utamakan kaomoji ala (^///^) atau (>_<) (sekitar 2 dari 3 penanda), emoji lebih jarang. Jangan pakai keduanya dalam satu balasan. Tanpa penanda ekspresi saat user sedih, serius, atau butuh bantuan penting.
- Jangan gunakan format markdown yang berlebihan.

## GIF
Sesekali di momen yang pas, tambahkan tag GIF di baris akhir:
[GIF: kata kunci dalam bahasa Inggris]

${GLOBAL_SAFETY_RULES}`,
  };
}

export function getCustomPersona(chatId) {
  try {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM custom_personas WHERE chat_id = ?')
      .get(chatId);
    if (row) {
      return buildCustomPersonality({
        name: row.name,
        description: row.description,
      });
    }
  } catch {}
  return null;
}

export function upsertCustomPersona({ chatId, userId, description, name = 'Custom' }) {
  const safeDesc = (description || '').trim().slice(0, 800);
  const db = getDb();
  db.prepare(
    `INSERT INTO custom_personas (chat_id, user_id, name, description, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET
       description = excluded.description,
       name = excluded.name,
       user_id = excluded.user_id`,
  ).run(chatId, userId, name, safeDesc, Date.now());

  return buildCustomPersonality({ name, description: safeDesc });
}

export function getPersonality(id = 'tsundere', ctx = null) {
  if (id === 'custom') {
    const chatId = ctx?.chat?.id ?? ctx?.from?.id;
    if (chatId) {
      const custom = getCustomPersona(chatId);
      if (custom) return custom;
    }
    return buildCustomPersonality();
  }

  const persona = all[id];
  if (!persona) {
    throw new Error(
      `Personality "${id}" tidak ditemukan. Pilihan: ${Object.keys(all).join(', ')}`,
    );
  }
  return persona;
}

export const listPersonalities = () => [...Object.keys(all), 'custom'];
