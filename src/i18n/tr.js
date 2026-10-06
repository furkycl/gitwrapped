// Türkçe string table. Same keys and function signatures as en.js (test/i18n.test.js
// checks it). Turkish puts no plural suffix after a number ("8 commit", "3 gün"), and the
// copy avoids attaching case suffixes to numbers, names or dates (their vowel harmony
// depends on how the value is read aloud), so every template works for any value.
import { formatDecimal, formatInteger } from './format.js';

const num = (n) => formatInteger(n, '.');
const dec = (n) => formatDecimal(n, '.', ',');
const plural = (n, [one, many]) => `${num(n)} ${n === 1 ? one : many}`;
const pad2 = (n) => String(n).padStart(2, '0');

const UNITS = {
  commit: ['commit', 'commit'],
  day: ['gün', 'gün'],
  file: ['dosya', 'dosya'],
  line: ['satır', 'satır'],
  language: ['dil', 'dil'],
  contributor: ['katkıcı', 'katkıcı'],
  time: ['kez', 'kez'],
  activeDay: ['aktif gün', 'aktif gün'],
  card: ['kart', 'kart'],
  png: ['PNG', 'PNG'],
  fix: ['fix', 'fix'],
};

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

export default {
  code: 'tr',
  name: 'Türkçe',

  // --- formatting ----------------------------------------------------------------------
  num,
  dec,
  pct: (r) => `%${r}`,
  // Turkish casing: i → İ, ı → I. The explicit i → İ first keeps it right even on a
  // Node build without full ICU (where the locale argument is ignored). The brands "git"
  // and "gitwrapped" and the loanword "commit" (also suffixed: commit'lerin) keep the plain
  // I: GITWRAPPED, COMMIT'LERİN.
  upper: (s) => String(s)
    .split(/(\bgit(?:wrapped)?\b|\bcommit(?=\b|'))/i)
    .map((part, i) => (i % 2 === 1 ? part.toUpperCase() : part.replace(/i/g, 'İ').toLocaleUpperCase('tr-TR')))
    .join(''),
  compact: { sep: '.', point: ',', suffixes: ['B', 'Mn', 'Mr', 'Tn'] },
  units: UNITS,
  months: MONTHS,
  weekdays: ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'],
  weekLetters: ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'],
  calendarWeekdays: ['P', 'S', 'Ç', 'P', 'C', 'C', 'P'],
  hourLabel: (h) => `${pad2(h)}:00`,
  hourTicks: { 0: '00', 6: '06', 12: '12', 18: '18', 23: '23' },
  date: (day, month, year) => `${day} ${MONTHS[month - 1]} ${year}`,
  sameYearRange: (d1, m1, d2, m2, year) => `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]} ${year}`,
  since: (date) => `${date} ve sonrası`,
  until: (date) => `${date} ve öncesi`,
  andList: (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} ve ${names[names.length - 1]}`),

  // --- story cards ---------------------------------------------------------------------
  empty: 'Henüz commit yok — hadi bir şeyler ship et!',
  yourRepo: 'repon',
  calendarOf: (days) => `${num(days)} aktif günlük commit takvimi`,

  intro: {
    eyebrow: 'gitwrapped sunar',
    title: 'Wrapped',
    lead: "Senin commit'lerin, senin kaosun, senin hikâyen. Bakalım neler karıştırmışsın.",
    starring: (who) => `Başrolde: ${who}.`,
    yearTitle: (year) => `Git'te geçen ${year} yılın`,
    soFar: 'Şimdiye kadarki hikâyen',
    toUnwrap: (commits) => `açılmayı bekleyen ${plural(commits, UNITS.commit)}`,
    quietYear: 'Sessiz bir yıl',
    noCommitsIn: (year) => `${year} yılında hiç commit yok`,
    chapterOne: 'Birinci bölüm',
    firstCommit: "ilk commit'inle başlıyor",
  },

  totals: {
    eyebrow: 'Genel toplam',
    activeDays: 'Aktif gün',
    filesTouched: 'Dokunulan dosya',
    contributors: 'Katkıcı',
    perDay: (value) => `Aktif gün başına ${value >= 100 ? num(value) : dec(value)} commit.`,
    everyOne: 'Her biri ayrı değerli.',
    linesChanged: 'Değişen satırlar',
    linesAdded: 'Eklenen satır',
    linesRemoved: 'Silinen satır',
  },

  peak: {
    eyebrow: 'Altın saatin',
    byHour: 'Saatlere göre commit',
    byWeekday: 'Günlere göre',
    barTitle: (label, commits) => `${label} · ${plural(commits, UNITS.commit)}`,
    noneBig: 'Zzz',
    noneTitle: 'Henüz altın saat yok',
    noneSubtitle: "Bir şeyler commit'le, altın saatini bulalım.",
    tied: (label, commits) => `${plural(commits, UNITS.commit)} ile ${label} en yoğun saatlerinden biri.`,
    landed: (commits, label) => `${plural(commits, UNITS.commit)} saat ${label} sularında geldi.`,
    quips: [
      'Böcekler geceleri çıkar, sen de öyle.',
      'Daha stand-up başlamadan push. Saygılar.',
      'Sabah verimliliğinin zirvesi. Ders kitabı gibi.',
      'Öğle arası mı? O da ne?',
      'Öğleden sonra mesaisi ciddi iş.',
      'Mesai sonrası kahramanı.',
      'Gece yarısı ship etmek, gelenektir.',
    ],
    dayTied: (day) => `${day}, en yoğun günlerinden biri.`,
    // A weekday name is lower-case inside a Turkish sentence (pazartesi); dayTied starts
    // the sentence with it, so it stays capitalized there.
    dayBusiest: (day) => `En yoğun günün ${String(day).replace(/^İ/, 'i').toLocaleLowerCase('tr-TR')}.`,
    titleTied: 'altın saatlerinden biri',
    title: 'en çok commit attığın saat',
  },

  streak: {
    eyebrow: 'En uzun serin',
    endOfYear: (year) => `${year} sonunda`,
    onDay: (date) => `${date} tarihinde`,
    chartTitle: 'En uzun ve şu anki',
    chartTitleEnd: 'En uzun ve dönem sonundaki',
    longest: 'En uzun',
    current: 'Şu an',
    windowEnd: 'Dönem sonu',
    longestTitle: (days, range) => `En uzun: ${plural(days, UNITS.day)}, ${range}`,
    zeroTitle: 'günlük seri',
    zeroSubtitle: 'Henüz seri yok — tek bir commit başlatır.',
    titleOne: 'günlük seri',
    titleMany: 'gün üst üste',
    onRange: (range) => `${range} günü.`,
    fromRange: (range) => `${range} arası.`,
    wasOn: (days, end) => `${end} ${num(days)} günlük bir serin vardı.`,
    wasNone: (end) => `${end} devam eden bir serin yoktu.`,
    isOn: (days) => `Şu an ${num(days)} günlük bir serin var. Sakın bozma!`,
    isNone: 'Şu an devam eden bir serin yok — başlamak için bugün harika bir gün.',
  },

  activity: {
    calendar: 'Commit takvimin',
    year: "Commit'lerle geçen bir yıl",
    last12: 'Son 12 ayın',
    monthsTo: (month, year) => `${MONTHS[month - 1]} ${year} itibarıyla 12 ay`,
    title: (_days) => 'aktif gün', // no plural after a number
    busiest: (date, commits) => `En yoğun gün: ${date}, ${plural(commits, UNITS.commit)}.`,
    weeks: (weeks) => (weeks === 1 ? 'Yalnızca 1 haftada boy gösterdin.' : `${num(weeks)} farklı haftada boy gösterdin.`),
  },

  hotFiles: {
    eyebrow: 'Gözde dosyaların',
    noneBig: 'Yok',
    noneTitle: 'Henüz gözde dosya yok',
    noneSubtitle: 'Bir dosyayı birkaç kez düzenle, burada belirsin.',
    titleTied: 'en çok dokunduğun dosyalardan biri',
    title: 'elini bir türlü çekemediğin dosya',
    subtitle: (commits, added, removed) => `${plural(commits, UNITS.commit)}, ${added} / ${removed} satır.`,
    chartTitle: 'En çok dokunulan dosyalar',
    barTitle: (path, commits, added, removed) => `${path}: ${plural(commits, UNITS.commit)}, ${added} / ${removed} satır`,
  },

  languages: {
    eyebrow: 'Dillerin',
    other: 'Diğer',
    barTitle: (label, lines, files, pct) => `${label}: ${plural(files, UNITS.file)} içinde ${plural(lines, UNITS.line)} değişti (${pct})`,
    shareOfFiles: 'Dokunulan dosya payı',
    shareOfLines: 'Değişen satır payı',
    noneBig: 'Yok',
    noneTitle: 'Hiç programlama dili bulunamadı',
    noneFiles: (files) => `${plural(files, UNITS.file)} değişti, hiçbiri tanıdığımız bir dilde değil. Gizemli.`,
    noneAtAll: 'Biraz kod yaz, dillerin burada görünsün.',
    tieMany: (n) => `Zirvede ${n} dil berabere`,
    tied: (list) => `Zirvede beraberlik: ${list}`,
    only: (name) => `Her an, her yerde ${name}`,
    mostly: (name) => `Çoğunlukla ${name}`,
    ledBy: (name) => `Başı ${name} çekiyor`,
    noCode: 'Bu sefer kod yok, sadece kelimeler ve veri.',
    oneLanguage: 'Tek dil, tam bağlılık.',
    polyglot: 'Çok dilli enerji.',
    summary: (count, code, files) => (count === 1
      ? `${plural(files, UNITS.file)} boyunca tek bir dile sadık kaldın.`
      : `${plural(files, UNITS.file)} boyunca ${plural(count, UNITS.language)} ile ${code ? 'kod ' : ''}yazdın.`),
    quips: {
      JavaScript: 'Her yerde çalışıyor, commit geçmişin dahil.',
      TypeScript: 'Baştan aşağı tipler.',
      Python: 'Girinti bir yaşam tarzı.',
      Go: 'if err != nil { yolaDevam() }',
      Rust: 'Borrow checker onayladı.',
      Java: 'AbstractSingletonCommitFactoryBean enerjisi.',
      Kotlin: 'Null güvenliği, ama eğlencelisinden.',
      Swift: 'Adı Swift, kendisi de hızlı.',
      C: 'Tehlikeli yaşıyorsun, her seferinde bir pointer.',
      'C++': 'Template büyücülüğü tespit edildi.',
      'C#': 'Noktalı virgül ve LINQ, klasik ikili.',
      Ruby: 'Geliştirici mutluluğu için optimize edildi.',
      PHP: "Web'in yarısını hâlâ o döndürüyor.",
      Shell: 'chmod +x ve gerisi kısmet.',
      HTML: 'Hypertext hâlâ en iyi text.',
      CSS: 'İlk günden beri div ortalıyor.',
      SCSS: 'Usta işi iç içe yazım.',
      Markdown: 'Dokümantasyon odaklı geliştirme. Saygılar.',
      JSON: 'Config de koddur, öyle görünüyor.',
      YAML: 'Girintiye duyarlı config fısıldayıcısı.',
      SQL: 'SELECT * FROM iyi_kararlar.',
      Dart: 'Hot reload, sıcak seri.',
      Haskell: 'Saf, tembel ve bundan gurur duyuyor.',
      Elixir: "Bırak çöksün, sonra yine commit'le.",
    },
  },

  messages: {
    eyebrow: 'Mesaj Şöhretler Salonu',
    noneTitle: 'Henüz commit mesajı yok',
    oops: (n) => `“Oops” ${n === 1 ? 'bir kez' : `${num(n)} kez`} yaşandı. Hepimizin başına geldi.`,
    average: (avg) => `Mesajların ortalama ${avg} karakter.`,
    longest: (quoted) => `En uzun: ${quoted}`,
    shortest: (quoted) => `En kısa: ${quoted}`,
    favorite: (times) => `en sevdiğin kelimeydi (${plural(times, UNITS.time)})`,
    averageTitle: 'karakter, mesaj başına ortalama',
    fixCommits: "“fix” commit'leri",
    wipCommits: "“wip” commit'leri",
    oopsCommits: "“oops” commit'leri",
  },

  personality: {
    eyebrow: 'Commit kişiliğin',
    chartTitle: 'Alışkanlık puanların',
    archetypes: {
      'night-owl': { name: 'Gece Kuşu', roast: 'En iyi fikirlerin gece yarısından sonra gelir. En kötüleri de.' },
      'early-bird': { name: 'Erkenci Kuş', roast: "Daha kahve demlenmeden push'luyorsun. Hava atma." },
      'friday-deployer': { name: "Cuma Deploy'cusu", roast: 'Cuma günü deploy edip buna cesaret diyorsun. Nöbetçi ekip başka bir şey diyor.' },
      fixaholic: { name: 'Fix Bağımlısı', roast: "Düzelttiğin her bug'ı önce sevgiyle sen yazdın." },
      'weekend-warrior': { name: 'Hafta Sonu Savaşçısı', roast: "Hafta sonları çimlere dokunmak içindir. Sen git'e dokundun." },
      'steady-shipper': { name: 'İstikrar Abidesi', roast: 'Güvenilir, tutarlı, dramsız. Açıkçası biraz şüpheli.' },
    },
    reasons: {
      'night-owl': (pct) => `Commit'lerinin %${pct} kadarı 22:00 ile 04:00 arasında geliyor.`,
      'early-bird': (pct) => `Commit'lerinin %${pct} kadarı 05:00 ile 09:00 arasında geliyor.`,
      'friday-deployer': (pct) => `Commit'lerinin %${pct} kadarı cuma günü geliyor.`,
      fixaholic: (pct) => `Commit mesajlarının %${pct} kadarı birer düzeltme.`,
      'weekend-warrior': (pct) => `Commit'lerinin %${pct} kadarı cumartesi ya da pazar geliyor.`,
      'steady-shipper': (activeDays, span, longest) => `${num(span)} günün ${num(activeDays)} gününde commit attın; en uzun serin ${num(longest)} gün.`,
    },
    notEnough: 'Henüz yeterince commit yok.',
  },

  contributors: {
    eyebrow: 'Ekip',
    unknown: 'Bilinmeyen',
    you: 'sen',
    youRank: (rank) => `sen · #${num(rank)}`,
    youName: (name) => `${name} (sen)`,
    barTitle: (who, rank, commits, share, added, removed) => `${who}: #${num(rank)}, ${plural(commits, UNITS.commit)} (${share}), ${added} / ${removed} satır`,
    chartTitle: 'En çok commit atanlar',
    ofTotal: (total) => `${plural(total, UNITS.contributor)} arasında`,
    youMade: (share, commits, added, removed) => `Commit'lerin ${share} kadarı senden: ${plural(commits, UNITS.commit)}, ${added} / ${removed} satır.`,
    teamwork: 'Birlikten commit doğar.',
    several: 'Birkaç kişi',
    shareLead: (who, commits) => `${who}, kişi başı ${plural(commits, UNITS.commit)} ile liderliği paylaşıyor.`,
    leads: (name, share) => `${name}, commit'lerin ${share} kadarıyla sürünün başında.`,
    title: 'katkıcı',
  },

  outro: {
    eyebrow: 'Hepsi bu kadar',
    big: 'Teşekkürler!',
    inOneCard: (repo) => `Tek kartta ${repo}`,
    subtitle: 'gitwrapped ile yapıldı. Kartlarını paylaş, bir takım arkadaşını etiketle.',
    commits: 'Commit',
    powerHour: 'Altın saat',
    bestStreak: 'En iyi seri',
    personality: 'Kişilik',
    noneYet: 'Henüz yok',
    tbd: 'Yakında',
    hottestFile: 'En gözde dosya',
  },

  share: {
    eyebrow: (year) => `${year ? `${year} ` : ''}Git Wrapped'im`,
    eyebrowAuthor: (year, who) => `${year ? `${year} ` : ''}Git Wrapped · ${who}`,
    noHotFiles: 'Henüz gözde dosya yok.',
  },

  calendar: {
    less: 'Az',
    more: 'Çok',
    cell: (date, commits) => `${date}: ${num(commits)} commit`,
  },

  // --- HTML viewer ---------------------------------------------------------------------
  viewer: {
    carousel: 'karusel',
    slide: 'slayt',
    slideLabel: (i, n) => `${i} / ${n}`,
    card: (i) => `Kart ${i}`,
    previous: 'Önceki kart',
    next: 'Sonraki kart',
    pause: 'Duraklat',
    play: 'Oynat',
    actions: 'Kart işlemleri',
    download: 'İndir: ',
    share: 'Paylaş',
    shortcuts: 'Klavye kısayolları',
    keyNext: 'Sonraki kart',
    keyPrevious: 'Önceki kart',
    keyFirstLast: 'İlk / son kart',
    keyPause: 'Otomatik geçişi duraklat / sürdür',
    keyDownload: 'Bu kartı PNG olarak indir',
    keyHelp: 'Bu yardımı göster',
    keyClose: 'Bu yardımı kapat',
    touch: 'Dokunmatik ekranlarda ileri gitmek için sağa, geri dönmek için sola dokun; geçmek için kaydır, duraklatmak için basılı tut.',
    close: 'Kapat',
    status: (i, n, title) => `Kart ${i} / ${n}: ${title}`,
    saved: (file) => `${file} kaydedildi`,
    pngFallback: (name) => `Bu tarayıcıda PNG kullanılamıyor; yerine ${name}.svg kaydedildi`,
    shareAgain: "Kartı paylaşmak için Paylaş'a tekrar dokun",
    shareFailed: 'Paylaşım başarısız oldu',
  },

  // --- terminal recap ------------------------------------------------------------------
  recap: {
    labelWidth: 15,
    noCommits: 'Hiç commit bulunamadı: kartlar oluşturuldu ama özetlenecek bir şey yok.',
    lines: 'satır',
    powerHour: 'Altın saat',
    tied: ', berabere',
    streak: 'Seri',
    longest: 'en uzun',
    current: 'şu an',
    atWindowEnd: 'dönem sonunda',
    hottestFile: 'Gözde dosya',
    topLanguage: 'Favori dil',
    languageDetail: (share, basis, tiedMore) => `${basis === 'files' ? 'dosyaların' : 'satırların'} ${share} kadarı${tiedMore > 0 ? `, ${num(tiedMore)} dil ile berabere` : ''}`,
    team: 'Ekip',
    youAre: 'sıran',
    ofCommits: (share) => `commit'lerin ${share} kadarı`,
    top: 'zirvede:',
    topWord: 'Favori kelime',
    you: 'Kişiliğin',
    cardsIn: (count, dir) => `${count}: ${dir}`,
    shareImage: 'paylaşım görseli:',
    statsJson: 'istatistik JSON:',
    opening: (file) => `${file} açılıyor…`,
  },

  notes: {
    truncatedFiltered: (n) => `Not: eşleşen commit sayısı ${n} üzerinde; yalnızca en yeni ${n} commit incelendi.`,
    truncated: (n) => `Not: bu repoda ${n} üzerinde commit var; yalnızca en yeni ${n} commit incelendi.`,
    teamTruncated: (n) => `Not: katkıcı kartı seni herkesin en yeni ${n} commit'i içinde sıralıyor.`,
    shallow: "Not: sığ klon (shallow clone): en eski (sınır) commit'in satır sayıları atlandı ve daha eski geçmiş eksik.",
    unborn: "Not: geçerli dalda (HEAD) henüz commit yok ve gitwrapped yalnızca HEAD'in geçmişini okur. Commit'i olan bir dala geç (ör. git switch main) ve tekrar çalıştır.",
    authorNotEmail: (author) => `Not: "${author}" için commit yok. --author bir e-posta adresi bekler (ör. sen@example.com).`,
    noMatch: (filters) => `Not: ${filters} ile eşleşen commit yok.`,
  },
};
