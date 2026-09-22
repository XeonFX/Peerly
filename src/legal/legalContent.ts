import { legalMeta as m } from './legalMeta'

/**
 * In-app legal texts (Privacy Policy + Terms). Authoritative source; the
 * `docs/legal/*.md` files are English exports. Written to match what Peerly
 * actually does: invite-only hybrid collaboration with encrypted durable
 * message delivery, peer-to-peer files/media, and no analytics.
 *
 * Not a substitute for review by a lawyer before a public/commercial launch.
 */
export type LegalBlock = { p: string } | { ul: string[] } | { note: string }
export type LegalSection = { heading: string; blocks: LegalBlock[] }
export type LegalDoc = { title: string; updated: string; intro: string; sections: LegalSection[] }
export type LegalDocId = 'privacy' | 'terms'

const updatedLabel = { pl: `Ostatnia aktualizacja: ${m.lastUpdated}`, en: `Last updated: ${m.lastUpdated}` }

// ---------------------------------------------------------------------------
// Privacy Policy
// ---------------------------------------------------------------------------

const privacyPl: LegalDoc = {
  title: 'Polityka prywatności',
  updated: updatedLabel.pl,
  intro:
    'Peerly to hybrydowe narzędzie do współpracy zespołowej. Wiadomości i reakcje są szyfrowane na urządzeniu i dostarczane oraz krótko przechowywane przez naszą infrastrukturę, natomiast pliki i połączenia podróżują bezpośrednio między przeglądarkami przez WebRTC (P2P). Korzystanie z Peerly wiąże się też z przetwarzaniem niektórych danych osobowych, np. adresu IP i adresów e-mail zaproszonych osób. Ten dokument to wyjaśnia.',
  sections: [
    {
      heading: '1. Administrator danych',
      blocks: [
        { p: `Administratorem danych jest ${m.controller} (osoba fizyczna prowadząca serwis Peerly), ${m.country}. Kontakt w sprawach prywatności: ${m.privacyEmail}.` },
      ],
    },
    {
      heading: '2. Nasze podejście: szyfrowana trwałość i P2P',
      blocks: [
        { p: 'Wiadomości, reakcje i definicje kanałów są szyfrowane w przeglądarce przed wysłaniem. Nasza infrastruktura Cloudflare Durable Objects przechowuje wyłącznie zaszyfrowane koperty zdarzeń i nie otrzymuje klucza przestrzeni ani rozmowy potrzebnego do odczytania treści. Pliki oraz obraz i dźwięk z połączeń nie są przechowywane w Durable Objects: pozostają lokalnie i są przesyłane P2P. P2P można również włączyć jako alternatywny transport wiadomości na poziomie wdrożenia.' },
      ],
    },
    {
      heading: '3. Jakie dane są przetwarzane',
      blocks: [
        { p: 'Logowanie (OIDC): logujesz się przez zewnętrznego dostawcę (Google, Microsoft, Apple lub inny OIDC). Token tożsamości jest wysyłany do naszego Workera w celu weryfikacji. Odczytany adres e-mail służy do utworzenia pseudonimowego identyfikatora członka; token i surowy adres e-mail nie są zapisywane w Durable Object. Nazwa i adres e-mail są też zapisywane lokalnie w przeglądarce.' },
        { p: 'Lista dostępu (zaproszenia): twórca przestrzeni podpisuje listę adresów e-mail osób uprawnionych do dołączenia. Uczestnicy widzą tę listę. Worker przetwarza ją przy autoryzacji, weryfikuje podpis i przekazuje Durable Object wyłącznie pseudonimowe identyfikatory członków, a nie surowe adresy.' },
        { p: 'Lobby i zaproszenia do znajomych: uwierzytelniony, nietrwały kanał Durable Object przekazuje podpisane dane obecności, zaproszeń i powiadomień DM. Dane te mogą zawierać adres e-mail nadawcy zaproszenia, ale nie są zapisywane jako historia ani skrzynka na serwerze.' },
        { p: 'Adres IP: natura WebRTC sprawia, że łącząc się z uczestnikiem prywatnej przestrzeni lub rozmowy, Wasze przeglądarki wymieniają adresy IP; są one też widoczne dla operatorów przekaźników/TURN. Publiczna obecność i routing zaproszeń korzystają z kanału przekaźnika i nie tworzą połączenia WebRTC z każdą osobą online.' },
        { p: 'Obecność w przestrzeni: nasz przekaźnik może tymczasowo (do ok. 45 sekund od ostatniego sygnału) przetwarzać niejawny identyfikator przestrzeni, pseudonimowy identyfikator członka i zaszyfrowane dane obecności, aby lista online działała także podczas zestawiania połączenia P2P. Przekaźnik nie otrzymuje klucza potrzebnego do odszyfrowania tych danych.' },
        { p: 'Treści i metadane: Durable Objects otrzymują zaszyfrowane wiadomości, reakcje i definicje kanałów oraz widoczne dla infrastruktury pseudonimowe identyfikatory użytkownika i urządzenia, typ zdarzenia i czas. Nazwa i awatar są szyfrowane w transporcie. Pliki oraz obraz/dźwięk z połączeń trafiają bezpośrednio do uczestników P2P.' },
        { p: 'Dane w urządzeniu: historia i pliki (IndexedDB), preferencje, klucz kryptograficzny urządzenia, zapamiętane przestrzenie i zgody — w pamięci lokalnej Twojej przeglądarki. Opcjonalne parowanie synchronizuje wybrane dane bezpośrednio między wzajemnie zatwierdzonymi urządzeniami, gdy oba są online; sesje logowania, tokeny tożsamości i prywatne klucze nie są kopiowane.' },
        { note: 'Nie prowadzimy analityki, nie używamy pikseli śledzących ani reklam. Nie sprzedajemy danych.' },
      ],
    },
    {
      heading: '4. Podstawy prawne (RODO art. 6)',
      blocks: [
        { ul: [
          'Wykonanie usługi, o którą prosisz (art. 6 ust. 1 lit. b) — dostarczenie zaszyfrowanych zdarzeń, zestawienie połączenia P2P oraz weryfikacja logowania i listy dostępu.',
          'Prawnie uzasadniony interes (art. 6 ust. 1 lit. f) — bezpieczeństwo infrastruktury, niezawodne dostarczanie i kontrola dostępu do przestrzeni.',
          'Zgoda (art. 6 ust. 1 lit. a) — dostęp do kamery/mikrofonu, akceptacja Regulaminu.',
        ] },
      ],
    },
    {
      heading: '5. Kto może zobaczyć Twoje dane',
      blocks: [
        { ul: [
          'Inni uczestnicy przestrzeni — widzą Twoją nazwę, awatar, wiadomości, pliki i Twój adres IP; twórca i uczestnicy widzą też listę zaproszonych adresów e-mail.',
          'Cloudflare i operator Peerly — zaszyfrowane koperty oraz pseudonimowe identyfikatory, typy zdarzeń, czas, krótkotrwałe dane lobby/zaproszeń i standardowe logi żądań; bez klucza do odczytania zaszyfrowanych treści.',
          'Operatorzy przekaźników i serwera TURN — metadane połączenia, krótkotrwałe pseudonimowe dane obecności i adresy IP.',
          'Dostawca logowania (Google/Microsoft/Apple/OIDC).',
        ] },
      ],
    },
    {
      heading: '6. Podmioty trzecie',
      blocks: [
        { ul: [
          'Dostawcy tożsamości OIDC — logowanie.',
          'Publiczne przekaźniki Nostr / relay WebSocket — sygnalizacja P2P.',
          'Serwer TURN (opcjonalnie).',
          'Cloudflare — hosting, Worker i Durable Objects przechowujące zaszyfrowane zdarzenia.',
        ] },
        { p: 'Niektórzy dostawcy mogą przetwarzać dane poza EOG na podstawie mechanizmów RODO (np. standardowych klauzul umownych).' },
      ],
    },
    {
      heading: '7. Przechowywanie i usuwanie',
      blocks: [
        { p: 'Zaszyfrowane zdarzenia są przechowywane maksymalnie przez 30 dni i w limicie 1000 najnowszych zdarzeń na przestrzeń lub rozmowę; starsze zdarzenia są automatycznie usuwane. Dane lokalne możesz usunąć w każdej chwili (wyloguj się, opuść lub wyczyść przestrzeń, wyczyść dane witryny). Kopie wysłane innym pozostają na ich urządzeniach. W sprawie kopii serwerowej napisz na adres kontaktowy poniżej.' },
      ],
    },
    {
      heading: '8. Twoje prawa',
      blocks: [
        { p: 'Masz prawo dostępu, sprostowania, usunięcia, ograniczenia, przenoszenia i sprzeciwu. Wiele z nich realizujesz samodzielnie w przeglądarce; w pozostałych sprawach napisz na ' + m.privacyEmail + '.' },
        { p: `Masz też prawo wnieść skargę do organu nadzorczego — ${m.supervisoryAuthority}.` },
      ],
    },
    {
      heading: '9. Pliki cookie i pamięć lokalna',
      blocks: [
        { p: 'Nie używamy plików cookie do śledzenia ani reklam. Korzystamy wyłącznie z niezbędnej pamięci lokalnej (localStorage/IndexedDB) do działania funkcji, które włączasz. Logowanie zewnętrzne może ustawiać własne pliki cookie dostawcy.' },
      ],
    },
    {
      heading: '10. Wiek użytkownika',
      blocks: [
        { p: `Peerly jest przeznaczony dla osób w wieku co najmniej ${m.minAge} lat.` },
      ],
    },
    {
      heading: '11. Bezpieczeństwo',
      blocks: [
        { p: 'Treść trwałych zdarzeń jest szyfrowana po stronie klienta (AES-GCM), połączenia P2P są szyfrowane (DTLS/SRTP), dostęp jest ograniczony do podpisanej listy członków, a tożsamość urządzeń i autorów jest weryfikowana kryptograficznie. Żaden system nie jest jednak w 100% bezpieczny.' },
      ],
    },
    {
      heading: '12. Zmiany',
      blocks: [
        { p: 'Możemy aktualizować tę Politykę; istotne zmiany zasygnalizujemy w aplikacji i poprosimy o ponowną akceptację.' },
      ],
    },
    {
      heading: '13. Kontakt',
      blocks: [
        { p: `Prywatność: ${m.privacyEmail} · Zgłoszenia nadużyć: ${m.abuseEmail}` },
      ],
    },
  ],
}

const privacyEn: LegalDoc = {
  title: 'Privacy Policy',
  updated: updatedLabel.en,
  intro:
    'Peerly is a hybrid team collaboration tool. Messages and reactions are encrypted on your device and delivered and briefly retained by our infrastructure, while files and calls travel directly between browsers over WebRTC (P2P). Using Peerly also involves processing some personal data, such as IP addresses and the email addresses of invited people. This document explains it.',
  sections: [
    {
      heading: '1. Data controller',
      blocks: [
        { p: `The controller is ${m.controller} (an individual operating the Peerly service), ${m.country}. Privacy contact: ${m.privacyEmail}.` },
      ],
    },
    {
      heading: '2. Our approach: encrypted durability and P2P',
      blocks: [
        { p: 'Messages, reactions, and channel definitions are encrypted in your browser before transmission. Our Cloudflare Durable Objects infrastructure stores only encrypted event envelopes and does not receive the workspace or conversation key needed to read their content. Files and call audio/video are not stored in Durable Objects: they remain local and transfer P2P. P2P can also be enabled as an alternative message transport at deployment level.' },
      ],
    },
    {
      heading: '3. What data is processed',
      blocks: [
        { p: 'Sign-in (OIDC): you sign in through a third-party provider (Google, Microsoft, Apple, or another OIDC provider). The ID token is sent to our Worker for verification. Its email is used to derive a pseudonymous member identifier; the token and raw email are not stored in a Durable Object. Your name and email are also stored locally in your browser.' },
        { p: 'Allow-list (invitations): the workspace creator signs a list of email addresses permitted to join, which members can see. The Worker processes that list during authorization, verifies its signature, and gives the Durable Object only pseudonymous member identifiers rather than raw addresses.' },
        { p: 'Lobby and friend invitations: an authenticated, non-persistent Durable Object channel forwards signed presence, invitation, and DM-notification data. This can include the invitation sender’s email, but it is not stored as server history or a mailbox.' },
        { p: 'IP address: by the nature of WebRTC, connecting to a participant in a private workspace or conversation means your browsers exchange IP addresses; they are also visible to relay/TURN operators. Public presence and invitation routing use a relay channel and do not create a WebRTC connection to every online user.' },
        { p: 'Workspace presence: our relay may temporarily process (for about 45 seconds after the latest signal) an opaque workspace identifier, a pseudonymous member identifier, and encrypted presence data so the online list works while P2P is still connecting. The relay does not receive the key needed to decrypt that data.' },
        { p: 'Content and metadata: Durable Objects receive encrypted messages, reactions, and channel definitions plus infrastructure-visible pseudonymous user and device identifiers, event type, and time. Names and avatars are encrypted in transit. Files and call audio/video go directly to participants P2P.' },
        { p: 'On-device data: history and files (IndexedDB), preferences, a device cryptographic key, remembered workspaces, and consents — in your browser’s local storage. Optional pairing syncs selected data directly between mutually approved devices while both are online; login sessions, identity tokens, and private keys are not copied.' },
        { note: 'We run no analytics, tracking pixels, or advertising. We do not sell data.' },
      ],
    },
    {
      heading: '4. Legal bases (GDPR Art. 6)',
      blocks: [
        { ul: [
          'Performance of the service you request (Art. 6(1)(b)) — delivering encrypted events, establishing the P2P connection, and verifying sign-in and the allow-list.',
          'Legitimate interests (Art. 6(1)(f)) — infrastructure security, reliable delivery, and workspace access control.',
          'Consent (Art. 6(1)(a)) — camera/microphone access, accepting the Terms.',
        ] },
      ],
    },
    {
      heading: '5. Who can see your data',
      blocks: [
        { ul: [
          'Other workspace participants — see your name, avatar, messages, files, and IP; the creator and members also see the list of invited email addresses.',
          'Cloudflare and the Peerly operator — encrypted envelopes plus pseudonymous identifiers, event types, times, transient lobby/invitation data, and standard request logs, without the key needed to read encrypted content.',
          'Relay and TURN operators — connection metadata, short-lived pseudonymous presence data, and IP addresses.',
          'The sign-in provider (Google/Microsoft/Apple/OIDC).',
        ] },
      ],
    },
    {
      heading: '6. Third parties',
      blocks: [
        { ul: [
          'OIDC identity providers — sign-in.',
          'Public Nostr / WebSocket relays — P2P signaling.',
          'TURN server (optional).',
          'Cloudflare — hosting, Worker, and Durable Objects that retain encrypted events.',
        ] },
        { p: 'Some providers may process data outside the EEA under GDPR transfer mechanisms (such as standard contractual clauses).' },
      ],
    },
    {
      heading: '7. Retention and deletion',
      blocks: [
        { p: 'Encrypted events are retained for at most 30 days and are capped at the latest 1,000 events per workspace or conversation; older events are removed automatically. You can delete local data at any time (sign out, leave or clear a workspace, clear site data). Copies sent to others remain on their devices. Contact us below about a server-held copy.' },
      ],
    },
    {
      heading: '8. Your rights',
      blocks: [
        { p: 'You have rights of access, rectification, erasure, restriction, portability, and objection. You exercise many yourself in the browser; for anything else email ' + m.privacyEmail + '.' },
        { p: `You may also complain to a supervisory authority — ${m.supervisoryAuthority}.` },
      ],
    },
    {
      heading: '9. Cookies and local storage',
      blocks: [
        { p: 'No cookies for tracking or advertising. Only essential local storage (localStorage/IndexedDB) for features you use. External sign-in may set the provider’s own cookies.' },
      ],
    },
    {
      heading: '10. Age',
      blocks: [
        { p: `Peerly is intended for people aged at least ${m.minAge}.` },
      ],
    },
    {
      heading: '11. Security',
      blocks: [
        { p: 'Durable event content is encrypted client-side (AES-GCM), P2P connections are encrypted (DTLS/SRTP), access is restricted to the signed membership list, and device and author identity is verified cryptographically. No system is 100% secure.' },
      ],
    },
    {
      heading: '12. Changes',
      blocks: [
        { p: 'We may update this Policy; we will signal material changes in the app and ask you to accept again.' },
      ],
    },
    {
      heading: '13. Contact',
      blocks: [
        { p: `Privacy: ${m.privacyEmail} · Abuse reports: ${m.abuseEmail}` },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Terms of Service
// ---------------------------------------------------------------------------

const termsPl: LegalDoc = {
  title: 'Regulamin',
  updated: updatedLabel.pl,
  intro: 'Niniejszy Regulamin określa zasady korzystania z Peerly. Korzystając z aplikacji, akceptujesz te zasady.',
  sections: [
    { heading: '1. Akceptacja', blocks: [{ p: 'Korzystanie z Peerly oznacza akceptację niniejszego Regulaminu oraz Polityki prywatności. Jeśli się nie zgadzasz, nie korzystaj z aplikacji.' }] },
    { heading: '2. Wiek', blocks: [{ p: `Musisz mieć co najmniej ${m.minAge} lat.` }] },
    { heading: '3. Charakter usługi', blocks: [{ p: 'Peerly to aplikacja hybrydowa: zaszyfrowane wiadomości i zdarzenia są dostarczane i czasowo przechowywane przez Durable Objects, a pliki i połączenia pozostają P2P. Dostarczamy oprogramowanie „takie, jakie jest”. Nie możemy odczytać ani centralnie moderować zaszyfrowanych treści i nie gwarantujemy dostępności ani jakości połączeń.' }] },
    { heading: '4. Twoja tożsamość i przestrzenie', blocks: [
      { p: 'Logujesz się przez zewnętrznego dostawcę tożsamości. Twórca przestrzeni decyduje, które adresy e-mail mogą dołączyć, i odpowiada za zgodność zaproszeń z prawem (np. za podstawę do przetwarzania adresów e-mail zaproszonych osób). Odpowiadasz za zachowanie kontroli nad swoim urządzeniem i kontem.' },
    ] },
    { heading: '5. Dozwolone korzystanie', blocks: [
      { p: 'Zobowiązujesz się nie używać Peerly do:' },
      { ul: [
        'działań niezgodnych z prawem lub naruszających prawa innych osób;',
        'treści nielegalnych, w tym materiałów przedstawiających wykorzystywanie dzieci (CSAM) — bezwzględnie zakazanych i zgłaszanych organom;',
        'nękania, gróźb ani mowy nienawiści;',
        'rozpowszechniania złośliwego oprogramowania, spamu ani prób obejścia zabezpieczeń;',
        'naruszania praw autorskich lub innych praw osób trzecich.',
      ] },
    ] },
    { heading: '6. Twoje treści i odpowiedzialność', blocks: [
      { p: 'Odpowiadasz za treści, które udostępniasz w przestrzeniach. Usunięcie zaszyfrowanej kopii serwerowej nie usuwa kopii, które zostały już zapisane na urządzeniach odbiorców.' },
    ] },
    { heading: '7. Własność i licencja', blocks: [{ p: 'Kod aplikacji jest udostępniany na licencji open source (MIT). Zachowujesz prawa do własnych treści.' }] },
    { heading: '8. Wyłączenie gwarancji', blocks: [{ p: 'Usługa dostarczana jest „tak, jak jest”, bez jakichkolwiek gwarancji, w tym co do dostępności, bezpieczeństwa czy zachowania innych uczestników.' }] },
    { heading: '9. Ograniczenie odpowiedzialności', blocks: [{ p: 'W maksymalnym zakresie dozwolonym przez prawo nie ponosimy odpowiedzialności za szkody wynikające z korzystania z aplikacji, w tym za treści i zachowanie innych uczestników. Nie wyłącza to odpowiedzialności, której nie można wyłączyć zgodnie z prawem (np. wobec konsumentów).' }] },
    { heading: '10. Zgłaszanie nadużyć i treści nielegalnych', blocks: [{ p: `Nielegalne treści lub nadużycia zgłaszaj na ${m.abuseEmail}. Przechowywane koperty są zaszyfrowane i nie możemy ich odczytać ani moderować, ale reagujemy w zakresie, w jakim jest to możliwe, i współpracujemy z właściwymi organami.` }] },
    { heading: '11. Zawieszenie dostępu', blocks: [{ p: 'Możemy ograniczyć lub odciąć dostęp do prowadzonej przez nas infrastruktury (np. przekaźnika) w razie naruszeń Regulaminu.' }] },
    { heading: '12. Prawo właściwe', blocks: [{ p: `Regulamin podlega prawu ${m.governingLaw}. Nie narusza to bezwzględnie obowiązujących praw konsumenta w kraju jego zamieszkania.` }] },
    { heading: '13. Zmiany', blocks: [{ p: 'Możemy aktualizować Regulamin; istotne zmiany zasygnalizujemy i poprosimy o ponowną akceptację.' }] },
    { heading: '14. Kontakt', blocks: [{ p: `Kontakt: ${m.privacyEmail} · Nadużycia: ${m.abuseEmail}` }] },
  ],
}

const termsEn: LegalDoc = {
  title: 'Terms of Service',
  updated: updatedLabel.en,
  intro: 'These Terms govern your use of Peerly. By using the app, you accept them.',
  sections: [
    { heading: '1. Acceptance', blocks: [{ p: 'Using Peerly means you accept these Terms and the Privacy Policy. If you disagree, do not use the app.' }] },
    { heading: '2. Age', blocks: [{ p: `You must be at least ${m.minAge}.` }] },
    { heading: '3. Nature of the service', blocks: [{ p: 'Peerly is a hybrid app: encrypted messages and events are delivered and temporarily retained by Durable Objects, while files and calls remain P2P. We provide the software “as is”. We cannot read or centrally moderate encrypted content and do not guarantee availability or connection quality.' }] },
    { heading: '4. Your identity and workspaces', blocks: [
      { p: 'You sign in through a third-party identity provider. The workspace creator decides which email addresses may join and is responsible for the lawfulness of invitations (including a basis for processing invited people’s email addresses). You are responsible for keeping control of your device and account.' },
    ] },
    { heading: '5. Acceptable use', blocks: [
      { p: 'You agree not to use Peerly for:' },
      { ul: [
        'unlawful activity or violating others’ rights;',
        'illegal content, including child sexual abuse material (CSAM) — strictly forbidden and reported to the authorities;',
        'harassment, threats, or hate speech;',
        'distributing malware or spam, or attempts to circumvent safeguards;',
        'infringing copyright or other third-party rights.',
      ] },
    ] },
    { heading: '6. Your content and responsibility', blocks: [
      { p: 'You are responsible for the content you share in workspaces. Removing an encrypted server-held copy does not remove copies already stored on recipients’ devices.' },
    ] },
    { heading: '7. Ownership and license', blocks: [{ p: 'The app code is released under an open-source license (MIT). You keep the rights to your own content.' }] },
    { heading: '8. Disclaimer of warranties', blocks: [{ p: 'The service is provided “as is”, without warranties of any kind, including as to availability, security, or the conduct of other participants.' }] },
    { heading: '9. Limitation of liability', blocks: [{ p: 'To the maximum extent permitted by law, we are not liable for damages arising from use of the app, including the content and conduct of other participants. This does not exclude liability that cannot be excluded by law (e.g. towards consumers).' }] },
    { heading: '10. Reporting abuse and illegal content', blocks: [{ p: `Report illegal content or abuse to ${m.abuseEmail}. Stored envelopes are encrypted and cannot be read or moderated by us, but we act to the extent we can and cooperate with the competent authorities.` }] },
    { heading: '11. Suspension of access', blocks: [{ p: 'We may restrict or cut off access to infrastructure we operate (such as a relay) in the event of Terms violations.' }] },
    { heading: '12. Governing law', blocks: [{ p: `These Terms are governed by the law of ${m.governingLaw}. This does not affect mandatory consumer-protection rights in your country of residence.` }] },
    { heading: '13. Changes', blocks: [{ p: 'We may update these Terms; we will signal material changes and ask you to accept again.' }] },
    { heading: '14. Contact', blocks: [{ p: `Contact: ${m.privacyEmail} · Abuse: ${m.abuseEmail}` }] },
  ],
}

export const legalDocs: Record<'pl' | 'en', Record<LegalDocId, LegalDoc>> = {
  pl: { privacy: privacyPl, terms: termsPl },
  en: { privacy: privacyEn, terms: termsEn },
}
