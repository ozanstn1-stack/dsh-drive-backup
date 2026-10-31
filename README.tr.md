# dsh-drive-backup

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) için
[rclone](https://rclone.org/) tabanlı yedek araçları.

`dsh-drive-backup`, DSH ajanına küçük ve açık bir yedek aracı seti verir: neyin
ayarlı olduğunu gör, uzak kopyanın güncel olup olmadığını kontrol et, doğrula ve
transferi çalıştır — sonuncusu yalnızca senin onayınla.

Hedefler ayarlardan gelen bir izin listesidir, komutlar argv dizisidir (kabuk
dizesi değil), deneme çalıştırması (dry-run) ücretsizdir ve her gerçek transfer
tek satır denetim kaydı bırakır.

## Araçlar

| Araç | Tür | Ne yapar |
| --- | --- | --- |
| `backup_targets` | salt-okunur | Ayarlı hedefleri listeler: yerel yol, rclone hedefi, mod, zaman aşımı, hariç tutmalar. |
| `backup_status` | salt-okunur | Tek hedef veya hepsi için yerel boyut, uzak boyut ve en yeni uzak dosyalar. |
| `backup_verify` | salt-okunur | Yerel yol ile uzak kopya arasında `rclone check`; eşleşen/farklı dosya sayısı ve örnekler. |
| `backup_transfer` | onaylı | Bir hedef için `rclone copy`/`sync`. `dryRun: true` onay istemez; gerçek transfer önce onay ister. |

## Modlar

- **`copy`** (varsayılan) — yeni ve değişmiş dosyaları yükler, uzaktaki dosyaları
  **asla silmez**. Zaman damgalı yedekler için güvenli.
- **`sync`** — yerel yolu aynalar; yerelde olmayan dosyalar uzakta **silinir**.
  Hedef başına açıkça seçilmelidir.

## Kurulum

```bash
dsh plugin --profile web add dsh-drive-backup
systemctl restart dsh-web   # veya DSH sürecinizi yeniden başlatın
```

Sonra rclone remote'unu ve hedeflerini ayarla:

```yaml
- id: drive-backup
  config:
    remote: grive
    targets:
      - id: openviking
        label: OpenViking hafızası
        local: /root/backups
        remotePath: dsh-backups/openviking
        mode: copy
        timeoutMs: 600000
      - id: kod
        label: Kod ve ayarlar
        local: /root/backups
        remotePath: dsh-backups/kod
        mode: copy
        excludes: ['*.log', '*.dump']
    verify:
      sizeOnly: true
    safety:
      readOnly: false
      requireApproval: true
      timeoutMs: 120000
      maxOutputBytes: 65536
    audit:
      file: /root/.dsh/logs/drive-backup-audit.log
```

`rclone` remote'u önceden ayarlanmış olmalı (`rclone config`); bu eklenti rclone
yapılandırma dosyasına dokunmaz ve kimlik bilgisi okumaz.

## Ayarlar

| Anahtar | Varsayılan | Anlamı |
| --- | --- | --- |
| `remote` | `grive` | rclone remote adı. |
| `rclone` | `rclone` | rclone çalıştırılabilir adı veya mutlak yolu. |
| `targets[].id` | — | Araçların kullandığı kimlik (`[a-z0-9_-]`). |
| `targets[].label` | `''` | İnsan etiketi; model kimlik yerine bunu da kullanabilir. |
| `targets[].local` | — | Mutlak yerel dosya veya dizin. |
| `targets[].remotePath` | — | Remote köküne göre yol; göreli, `..` içermez. |
| `targets[].mode` | `copy` | `copy` veya `sync`. |
| `targets[].excludes` | `[]` | rclone hariç tutma desenleri. |
| `targets[].transfers` | `4` | Paralel transfer sayısı. |
| `targets[].timeoutMs` | `600000` | Bu hedef için duvar saati sınırı. |
| `verify.sizeOnly` | `true` | Yalnızca boyut karşılaştır; `false` hash karşılaştırır (yavaş). |
| `safety.readOnly` | `false` | `true` iken `backup_transfer` reddeder; inceleme çalışır. |
| `safety.requireApproval` | `true` | Gerçek transferler önce onay ister. |
| `safety.timeoutMs` | `120000` | Varsayılan komut zaman aşımı. |
| `safety.maxOutputBytes` | `65536` | Çağrı başına çıktı sınırı. |
| `audit.file` | `<DSH_HOME>/logs/drive-backup-audit.log` | Denetim dosyası. |

## Güvenlik modeli

- **İzin listesi.** Yalnızca ayarlı hedefler vardır; bilinmeyen kimlik, ayarlı
  listeyle birlikte reddedilir ve modele isim uydurmaması söylenir.
- **Yalnızca argv.** `rclone` çalıştırılabilir + argüman dizisi olarak koşar;
  hedef yolları kabuk sözdizimine dönüşmez, remote yolları doğrulanır (göreli,
  `..` yok).
- **Önce dry-run.** `backup_transfer` + `dryRun: true` neyin taşınacağını listeler,
  onay istemez.
- **Onay kapalı-kapıya.** Gerçek transfer yalnızca `allowed-once` ile çalışır;
  onay mekanizması yoksa veya hata verirse hiçbir şey olmaz.
- **Sınırlı.** Her transferin zaman aşımı ve çıktı sınırı vardır.
- **Denetimli.** Deneme başına tek JSON satırı:
  `{"ts":"…","tool":"backup_transfer","target":"openviking","mode":"copy","outcome":"executed",…}`.

## Örnek akış

```
backup_status                              → yerelde ne var, uzakta ne var, ne kadar taze
backup_transfer {id:"openviking", dryRun:true}  → ne yükleneceğini göster (onaysız)
backup_transfer {id:"openviking"}               → onay kartı → transfer → denetim satırı
backup_verify {id:"openviking"}            → "2 dosya eşleşiyor, 0 farklı"
```

## Gereksinimler

- DSH `>= 0.2.1-rc.4` (Node `^22.19.0 || >=24.0.0`).
- PATH'te `rclone` (veya mutlak yolla ayarlı) ve remote'un kurulu olması.

## Geliştirme

```bash
npm run link-peers
node --test
```

## Lisans

MIT
