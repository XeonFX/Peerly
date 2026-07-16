/* oxlint-disable react/only-export-components -- provider and its matching hook are one API. */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Locale = 'en' | 'pl'
const LOCALE_KEY = 'peerly-locale'

const pl: Record<string, string> = {
  'settings.attention.title': 'Uwaga i powiadomienia',
  'settings.attention.description':
    'Liczba nieprzeczytanych wiadomości pojawia się automatycznie na karcie i ikonie. Powiadomienia przeglądarki są opcjonalne i dotyczą tylko wiadomości bezpośrednich, gdy Peerly działa w tle.',
  'settings.attention.enable': 'Włącz powiadomienia DM',
  'settings.attention.disable': 'Wyłącz powiadomienia DM',
  'settings.language': 'Język',
}

const plByEnglish: Record<string, string> = {
  'Back to channels': 'Wróć do kanałów',
  'Workspace settings': 'Ustawienia przestrzeni',
  'Customize how this workspace appears on this device. The name travels with invite links you copy from here; the icon stays local.':
    'Dostosuj wygląd tej przestrzeni na tym urządzeniu. Nazwa trafia do kopiowanych tutaj linków zaproszeń; ikona pozostaje lokalna.',
  'Switch workspace': 'Zmień przestrzeń',
  'Close workspace menu': 'Zamknij menu przestrzeni',
  'Open workspace menu': 'Otwórz menu przestrzeni',
  Channels: 'Kanały',
  'Add a channel': 'Dodaj kanał',
  'Move channel up': 'Przenieś kanał wyżej',
  'Move channel down': 'Przenieś kanał niżej',
  'Rename channel': 'Zmień nazwę kanału',
  'Delete channel': 'Usuń kanał',
  'Move {channel} up': 'Przenieś kanał {channel} wyżej',
  'Move {channel} down': 'Przenieś kanał {channel} niżej',
  'Rename {channel}': 'Zmień nazwę kanału {channel}',
  'Delete {channel}': 'Usuń kanał {channel}',
  'Delete #{channel} from this workspace?': 'Usunąć kanał #{channel} z tej przestrzeni?',
  'Close direct message with {name}': 'Zamknij wiadomość bezpośrednią z {name}',
  'Message {name}': 'Napisz do {name}',
  '{count} signaling endpoint · P2P encrypted':
    '{count} punkt sygnalizacyjny · szyfrowanie P2P',
  '{count} signaling endpoints · P2P encrypted':
    '{count} punkty sygnalizacyjne · szyfrowanie P2P',
  'Connecting to signaling': 'Łączenie z sygnalizacją',
  'Channel name': 'Nazwa kanału',
  'e.g. random': 'np. luźne',
  Add: 'Dodaj',
  'Direct messages': 'Wiadomości bezpośrednie',
  'Close direct message': 'Zamknij wiadomość bezpośrednią',
  Online: 'Online',
  'Open your profile': 'Otwórz swój profil',
  you: 'ty',
  'Your profile': 'Twój profil',
  'Customize how teammates see you in this workspace.':
    'Dostosuj sposób, w jaki widzą Cię współpracownicy w tej przestrzeni.',
  'Avatar images are auto-resized and saved as WebP.':
    'Awatary są automatycznie zmniejszane i zapisywane jako WebP.',
  'Display name': 'Nazwa wyświetlana',
  'Your name': 'Twoje imię',
  'Your color': 'Twój kolor',
  'Use color {color}': 'Użyj koloru {color}',
  'Upload avatar': 'Prześlij awatar',
  'Failed to upload avatar.': 'Nie udało się przesłać awatara.',
  Processing: 'Przetwarzanie',
  'Remove avatar': 'Usuń awatar',
  'Workspace info': 'Informacje o przestrzeni',
  Workspace: 'Przestrzeń',
  'Your peer ID': 'Twój identyfikator peera',
  Protection: 'Ochrona',
  'Invite-only (verified accounts)': 'Tylko na zaproszenie (zweryfikowane konta)',
  'Invite link': 'Link zaproszenia',
  Connection: 'Połączenie',
  'Shared files': 'Udostępnione pliki',
  'No shared files yet': 'Nie udostępniono jeszcze żadnych plików',
  'Use the paperclip beside the message box to share the first file.':
    'Użyj spinacza obok pola wiadomości, aby udostępnić pierwszy plik.',
  cached: 'w pamięci',
  Save: 'Zapisz',
  'on demand': 'na żądanie',
  'Drop files to share': 'Upuść pliki, aby je udostępnić',
  'Attach a file to share with everyone in this channel':
    'Dołącz plik do udostępnienia wszystkim na tym kanale',
  'Attach file': 'Dołącz plik',
  Send: 'Wyślij',
  Preview: 'Podgląd',
  'Download original': 'Pobierz oryginał',
  'Sensitive media hidden': 'Ukryto wrażliwe multimedia',
  'Checked privately on this device': 'Sprawdzono prywatnie na tym urządzeniu',
  Reveal: 'Pokaż',
  'Ready on this device': 'Gotowe na tym urządzeniu',
  'Download on demand': 'Pobierz na żądanie',
  Receiving: 'Odbieranie',
  Sending: 'Wysyłanie',
  'Message {channel}': 'Wiadomość do {channel}',
  'Message #{channel}': 'Wiadomość na #{channel}',
  'Start the conversation': 'Rozpocznij rozmowę',
  'Messages are sent directly peer-to-peer. No server stores your data.':
    'Wiadomości są wysyłane bezpośrednio peer-to-peer. Żaden serwer nie przechowuje Twoich danych.',
  edited: 'edytowano',
  'Edit message': 'Edytuj wiadomość',
  'Delete message': 'Usuń wiadomość',
  'Message deleted': 'Wiadomość usunięta',
  'Delete this message for everyone online?':
    'Usunąć tę wiadomość u wszystkich osób online?',
  'a file': 'plik',
  '{name} shared {file}': '{name} udostępnił(-a) {file}',
  'Shared {file}': 'Udostępniono {file}',
  '{emoji} reaction, {count}': 'Reakcja {emoji}, liczba: {count}',
  'React {emoji}': 'Zareaguj {emoji}',
  'new message': 'nowa wiadomość',
  'new messages': 'nowe wiadomości',
  Connectivity: 'Łączność',
  'This local test catches disabled WebRTC. Strict NAT and corporate firewalls can only be confirmed when another device attempts to connect.':
    'Ten lokalny test wykrywa wyłączone WebRTC. Restrykcyjny NAT i zapory firmowe można potwierdzić dopiero, gdy inne urządzenie spróbuje się połączyć.',
  'Test again': 'Sprawdź ponownie',
  'local check': 'test lokalny',
  'Sensitive video hidden': 'Ukryto wrażliwe wideo',
  'Reveal stream': 'Pokaż transmisję',
  'Video call': 'Rozmowa wideo',
  participants: 'uczestników',
  'End call': 'Zakończ rozmowę',
  'Turn off camera': 'Wyłącz kamerę',
  'Turn on camera': 'Włącz kamerę',
  Mute: 'Wycisz',
  Unmute: 'Włącz dźwięk',
  'Mute microphone': 'Wycisz mikrofon',
  'Unmute microphone': 'Włącz mikrofon',
  'Stop sharing screen': 'Zatrzymaj udostępnianie ekranu',
  'Share screen': 'Udostępnij ekran',
  Microphone: 'Mikrofon',
  Camera: 'Kamera',
  'Toggle shared files': 'Pokaż lub ukryj udostępnione pliki',
  Files: 'Pliki',
  'A teammate': 'Współpracownik',
  'started a video call.': 'rozpoczął(-ęła) rozmowę wideo.',
  Join: 'Dołącz',
  Dismiss: 'Odrzuć',
  'Start video call': 'Rozpocznij rozmowę wideo',
  'Join incoming call': 'Dołącz do przychodzącej rozmowy',
  'In call': 'W rozmowie',
  'Join call': 'Dołącz do rozmowy',
  'Invite link copied': 'Skopiowano link zaproszenia',
  'Copy invite link': 'Kopiuj link zaproszenia',
  'Invite people': 'Zaproś osoby',
  'Emails to invite': 'Adresy e-mail do zaproszenia',
  Cancel: 'Anuluj',
  Inviting: 'Zapraszanie',
  "They'll appear in the invite link immediately — copy it and send it to them.":
    'Od razu pojawią się w linku zaproszenia — skopiuj go i wyślij im.',
  'Only the creator can add people, from the device they created the workspace on. Share the link above with anyone already invited.':
    'Tylko twórca może dodawać osoby i musi użyć urządzenia, na którym utworzył przestrzeń. Udostępnij powyższy link każdej już zaproszonej osobie.',
  'Remove from the invite list. Members who receive the update stop admitting them at their next connection.':
    'Usuń z listy zaproszeń. Osoby, które otrzymają aktualizację, przestaną dopuszczać to konto przy następnym połączeniu.',
  'Copy the invite link for people already invited':
    'Skopiuj link zaproszenia dla już zaproszonych osób',
  'Sign out': 'Wyloguj się',
  'Your email (test mode)': 'Twój e-mail (tryb testowy)',
  'Continue with': 'Kontynuuj przez',
  'Private by design': 'Prywatność od podstaw',
  'Your team space, directly between your devices.':
    'Przestrzeń Twojego zespołu, bezpośrednio między urządzeniami.',
  'No message or file server in the middle. Invite-only workspaces connect through verified identities.':
    'Bez pośredniego serwera wiadomości ani plików. Przestrzenie na zaproszenie łączą zweryfikowane tożsamości.',
  'Serverless team collaboration — chat, video, and files, peer-to-peer.':
    'Współpraca zespołowa bez serwera — czat, wideo i pliki peer-to-peer.',
  'Sign in to continue': 'Zaloguj się, aby kontynuować',
  "Only invited accounts can connect. Peers verify each other's identity before any data flows. Sign in with the account you were invited with — a different provider or email counts as a different person.":
    'Połączyć mogą się wyłącznie zaproszone konta. Peery weryfikują wzajemnie tożsamość przed przesłaniem danych. Zaloguj się zaproszonym kontem — inny dostawca lub e-mail oznacza inną osobę.',
  'Your workspaces': 'Twoje przestrzenie',
  "You've been invited to": 'Masz zaproszenie do',
  'Import backup': 'Importuj kopię zapasową',
  'No workspaces remembered in this browser. Import a backup or create a new one.':
    'Ta przeglądarka nie pamięta żadnych przestrzeni. Zaimportuj kopię zapasową lub utwórz nową.',
  member: 'osoba',
  members: 'osób',
  'Free local space by removing cached full-size files. Messages and previews stay available.':
    'Zwolnij miejsce, usuwając pełne pliki z pamięci podręcznej. Wiadomości i podglądy pozostaną dostępne.',
  'Remove from this list (does not affect the workspace)':
    'Usuń z tej listy (bez wpływu na przestrzeń)',
  'Create workspace': 'Utwórz przestrzeń',
  'Join with invite': 'Dołącz z zaproszeniem',
  'Workspace name': 'Nazwa przestrzeni',
  'My team': 'Mój zespół',
  'Invite teammates': 'Zaproś współpracowników',
  optional: 'opcjonalnie',
  "You'll get a secret invite link to share. You can add more people later.":
    'Otrzymasz tajny link zaproszenia do udostępnienia. Więcej osób możesz dodać później.',
  Working: 'Przetwarzanie',
  Joining: 'Dołączanie',
  'Join workspace': 'Dołącz do przestrzeni',
  'Sign in with one of the providers above to continue':
    'Zaloguj się przez jednego z powyższych dostawców, aby kontynuować',
  'Workspace name is required': 'Nazwa przestrzeni jest wymagana',
  'Stored workspace has an invalid signature — rejoin with the invite link':
    'Zapisana przestrzeń ma nieprawidłowy podpis — dołącz ponownie przez link zaproszenia',
  'Open a valid invite link to join a workspace':
    'Otwórz prawidłowy link zaproszenia, aby dołączyć do przestrzeni',
  'Invite link signature is invalid': 'Podpis linku zaproszenia jest nieprawidłowy',
  '{email} is not on this workspace\'s invite list':
    'Adresu {email} nie ma na liście zaproszeń tej przestrzeni',
  'Backup is larger than the {size} import limit':
    'Kopia zapasowa przekracza limit importu {size}',
  'Restored “{workspace}” — imported {count} message.':
    'Przywrócono „{workspace}” — zaimportowano {count} wiadomość.',
  'Restored “{workspace}” — imported {count} messages.':
    'Przywrócono „{workspace}” — zaimportowano {count} wiadomości.',
  'Restored "{workspace}" — {count} message imported.':
    'Przywrócono „{workspace}” — zaimportowano {count} wiadomość.',
  'Restored "{workspace}" — {count} messages imported.':
    'Przywrócono „{workspace}” — zaimportowano {count} wiadomości.',
  'on device': 'na urządzeniu',
  shared: 'udostępnione',
  'Free local space for {workspace}': 'Zwolnij miejsce lokalne dla {workspace}',
  'Forget {workspace}': 'Zapomnij przestrzeń {workspace}',
  'Remove cached full-size files for “{workspace}”? Messages and previews stay, and originals can be fetched again while a peer has them.':
    'Usunąć pełne pliki przestrzeni „{workspace}” z pamięci? Wiadomości i podglądy pozostaną, a oryginały będzie można pobrać ponownie, gdy ma je inny peer.',
  Copy: 'Kopiuj',
  'Open an invite link from your workspace creator — it looks like':
    'Otwórz link zaproszenia od twórcy przestrzeni — wygląda tak:',
  'Workspace images are auto-resized and saved as WebP.':
    'Obrazy przestrzeni są automatycznie zmniejszane i zapisywane jako WebP.',
  'Upload workspace image': 'Prześlij obraz przestrzeni',
  'Failed to upload workspace image.': 'Nie udało się przesłać obrazu przestrzeni.',
  'Failed to remove workspace image.': 'Nie udało się usunąć obrazu przestrzeni.',
  'Remove image': 'Usuń obraz',
  Appearance: 'Wygląd',
  'Theme preference is stored only on this device.':
    'Preferencja motywu jest zapisana tylko na tym urządzeniu.',
  'This browser does not support notifications.':
    'Ta przeglądarka nie obsługuje powiadomień.',
  'Notifications are blocked in browser settings. Allow them for this site, then reload.':
    'Powiadomienia są zablokowane w ustawieniach przeglądarki. Zezwól na nie dla tej witryny i odśwież stronę.',
  'Turn off attention sounds': 'Wyłącz dźwięki powiadomień',
  'Turn on attention sounds': 'Włącz dźwięki powiadomień',
  'Plays a short background DM chime and repeats a gentle ringtone for incoming calls.':
    'Odtwarza krótki sygnał wiadomości bezpośredniej w tle i łagodny, powtarzany dzwonek połączenia przychodzącego.',
  'Storage & sync': 'Pamięć i synchronizacja',
  'On this device': 'Na tym urządzeniu',
  'Shared total': 'Łącznie udostępnione',
  Free: 'Wolne',
  Measuring: 'Pomiar',
  messages: 'wiadomości',
  'cached file': 'plik w pamięci',
  'cached files': 'plików w pamięci',
  across: 'w',
  file: 'pliku',
  files: 'plikach',
  'local space': 'miejsce lokalne',
  'Remove unpinned full-size files from this device? Messages and previews stay available.':
    'Usunąć z tego urządzenia nieprzypięte pełne pliki? Wiadomości i podglądy pozostaną dostępne.',
  'Clear local messages, previews, read state, and cached files for this workspace? Access remains, and history can re-sync from online peers.':
    'Wyczyścić lokalne wiadomości, podglądy, stan odczytu i pliki w pamięci tej przestrzeni? Dostęp pozostanie, a historia może ponownie zsynchronizować się z peerów online.',
  'Clear local history': 'Wyczyść lokalną historię',
  'Export backup': 'Eksportuj kopię zapasową',
  'Backups carry workspace-channel messages and access, so protect them like an invite link. History caps at 500 messages per channel. DMs and file originals are excluded; originals re-fetch from members who hold them. Restore from the start screen with “Import backup”.':
    'Kopie zapasowe zawierają wiadomości kanałów przestrzeni i dane dostępu, więc chroń je jak link zaproszenia. Historia jest ograniczona do 500 wiadomości na kanał. Wiadomości bezpośrednie i oryginały plików są pomijane; oryginały można ponownie pobrać od osób, które je posiadają. Przywracanie odbywa się na ekranie startowym przez „Importuj kopię zapasową”.',
  'Auto-download full files': 'Automatycznie pobieraj pełne pliki',
  'Off: joining syncs messages and image thumbnails only; full-size files download when you open them. On: every shared file downloads immediately. Applies to all workspaces on this device.':
    'Wyłączone: po dołączeniu synchronizowane są tylko wiadomości i miniatury obrazów; pełne pliki są pobierane po ich otwarciu. Włączone: każdy udostępniony plik jest pobierany od razu. Dotyczy wszystkich przestrzeni na tym urządzeniu.',
  'Browser storage': 'Pamięć przeglądarki',
  'Availability unknown': 'Dostępne miejsce nieznane',
  available: 'dostępne',
  used: 'wykorzystane',
  'The browser did not provide a quota estimate.':
    'Przeglądarka nie podała szacowanego limitu.',
  'Storage estimates are unavailable in this browser.':
    'Szacowanie pamięci jest niedostępne w tej przeglądarce.',
  'Browser quota is an estimate, not a guaranteed reservation.':
    'Limit przeglądarki jest szacunkowy i nie stanowi gwarantowanej rezerwacji.',
  'Refresh estimate': 'Odśwież oszacowanie',
  'Ask the browser not to evict Peerly data automatically. This does not increase quota.':
    'Poproś przeglądarkę, aby nie usuwała automatycznie danych Peerly. Nie zwiększa to limitu.',
  Requesting: 'Wysyłanie prośby',
  'Protect local data': 'Chroń dane lokalne',
  'Local data protected': 'Dane lokalne są chronione',
  'Manage storage': 'Zarządzaj pamięcią',
  'Browser storage almost full': 'Pamięć przeglądarki jest prawie pełna',
  'Browser storage is getting low': 'Kończy się pamięć przeglądarki',
  'background file downloads are paused': 'pobieranie plików w tle jest wstrzymane',
  'There is room for cached files and previews.':
    'Jest miejsce na pliki w pamięci podręcznej i podglądy.',
  'Storage is filling up. Consider removing originals you no longer need offline.':
    'Pamięć się zapełnia. Rozważ usunięcie oryginałów, których nie potrzebujesz offline.',
  'Storage is running low. Automatic original-file downloads are paused.':
    'Kończy się pamięć. Automatyczne pobieranie oryginalnych plików jest wstrzymane.',
  'Storage is almost full. Background media sync is paused to keep messages working.':
    'Pamięć jest prawie pełna. Synchronizacja multimediów w tle została wstrzymana, aby wiadomości nadal działały.',
  'Checking P2P': 'Sprawdzanie P2P',
  'P2P ready': 'P2P gotowe',
  'P2P unavailable': 'P2P niedostępne',
  'P2P blocked': 'P2P zablokowane',
  'Signaling offline': 'Sygnalizacja offline',
  Connecting: 'Łączenie',
  'Waiting for peers': 'Oczekiwanie na peery',
  Connected: 'Połączono',
  peer: 'peer',
  peers: 'peerów',
  'Connection problem': 'Problem z połączeniem',
  Unknown: 'Nieznany stan',
  Ready: 'Gotowe',
  Attention: 'Uwaga',
  Testing: 'Testowanie',
  'P2P active': 'P2P aktywne',
  '{count} direct peer connection verified on this network.':
    'W tej sieci zweryfikowano {count} bezpośrednie połączenie peer.',
  '{count} direct peer connections verified on this network.':
    'W tej sieci zweryfikowano {count} bezpośrednich połączeń peer.',
  'P2P path blocked': 'Ścieżka P2P zablokowana',
  'Signaling found a teammate, but this network could not open a direct path. TURN fallback is required.':
    'Sygnalizacja znalazła współpracownika, ale ta sieć nie mogła otworzyć bezpośredniej ścieżki. Wymagany jest zapasowy TURN.',
  'Browser WebRTC data channels are enabled. A real network path is confirmed when a teammate connects.':
    'Kanały danych WebRTC są włączone. Rzeczywista ścieżka sieciowa zostanie potwierdzona po połączeniu współpracownika.',
  'This browser does not expose WebRTC peer connections.':
    'Ta przeglądarka nie udostępnia połączeń peer WebRTC.',
  'Full-size file sync paused': 'Synchronizacja pełnych plików wstrzymana',
  'Syncing workspace': 'Synchronizowanie przestrzeni',
  'Workspace sync progress': 'Postęp synchronizacji przestrzeni',
  'Light mode': 'Tryb jasny',
  'Dark mode': 'Tryb ciemny',
  'Switch to light mode': 'Przełącz na tryb jasny',
  'Switch to dark mode': 'Przełącz na tryb ciemny',
  'Signing in': 'Logowanie',
  'Sign in (test mode)': 'Zaloguj się (tryb testowy)',
  'Enter your email to continue': 'Wpisz swój e-mail, aby kontynuować',
  'Sign-in failed': 'Logowanie nie powiodło się',
  'Still connecting — try again in a moment': 'Nadal trwa łączenie — spróbuj ponownie za chwilę',
  'Signed in as {actual}, but this workspace admitted {expected}. Use the same account.':
    'Zalogowano jako {actual}, ale ta przestrzeń dopuściła {expected}. Użyj tego samego konta.',
  'Your sign-in expired. Current connections keep working, but nobody new can verify you until you sign in again.':
    'Twoje logowanie wygasło. Obecne połączenia nadal działają, ale nikt nowy nie zweryfikuje Cię, dopóki nie zalogujesz się ponownie.',
  'Your sign-in expires in a few minutes. Renew it to keep accepting new connections.':
    'Twoje logowanie wygaśnie za kilka minut. Odnów je, aby nadal przyjmować nowe połączenia.',
  'Sign in again': 'Zaloguj się ponownie',
  'Identity provider “{provider}” is not configured':
    'Dostawca tożsamości „{provider}” nie jest skonfigurowany',
  'Remove {email}': 'Usuń {email}',
  'Could not copy — copy the link from the address bar after joining':
    'Nie udało się skopiować — po dołączeniu skopiuj link z paska adresu',
  'Enter at least one email address': 'Wpisz co najmniej jeden adres e-mail',
  'Not an email address: {email}': 'To nie jest adres e-mail: {email}',
  'Test P2P again': 'Sprawdź P2P ponownie',
}

function interpolate(text: string, values?: Record<string, string | number>): string {
  if (!values) return text
  return text.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? `{${key}}`))
}

function initialLocale(): Locale {
  const saved = localStorage.getItem(LOCALE_KEY)
  if (saved === 'en' || saved === 'pl') return saved
  return navigator.language.toLowerCase().startsWith('pl') ? 'pl' : 'en'
}

type I18nValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, english: string) => string
  tr: (english: string, values?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale: next => {
        localStorage.setItem(LOCALE_KEY, next)
        document.documentElement.lang = next
        setLocaleState(next)
      },
      t: (key, english) => (locale === 'pl' ? (pl[key] ?? english) : english),
      tr: (english, values) =>
        interpolate(locale === 'pl' ? (plByEnglish[english] ?? english) : english, values),
    }),
    [locale]
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used within I18nProvider')
  return value
}
