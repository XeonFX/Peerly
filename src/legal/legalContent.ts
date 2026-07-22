import { legalMeta as m } from './legalMeta'

/**
 * In-app legal texts (Privacy Policy + Terms). Authoritative source; the
 * `docs/legal/*.md` files are English exports. Written to match what Peerly
 * actually does: invite-only P2P team collaboration with client-side OIDC, no
 * application server storing messages or files, and no analytics.
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
    'Peerly to narzędzie do współpracy zespołowej działające w modelu peer-to-peer (P2P): wiadomości, pliki i połączenia podróżują bezpośrednio między przeglądarkami przez WebRTC. Nie prowadzimy serwera, który przechowywałby treści Twojej przestrzeni roboczej. Mimo to korzystanie z Peerly wiąże się z przetwarzaniem niektórych danych osobowych (np. adresu IP i adresów e-mail zaproszonych osób). Ten dokument to wyjaśnia.',
  sections: [
    {
      heading: '1. Administrator danych',
      blocks: [
        { p: `Administratorem danych jest ${m.controller} (osoba fizyczna prowadząca serwis Peerly), ${m.country}. Kontakt w sprawach prywatności: ${m.privacyEmail}.` },
      ],
    },
    {
      heading: '2. Nasze podejście: brak serwera aplikacji',
      blocks: [
        { p: 'Peerly nie ma backendu przechowującego wiadomości, pliki ani historię przestrzeni roboczych. Te dane są przechowywane lokalnie w Twojej przeglądarce i przesyłane bezpośrednio do zaproszonych uczestników. Do nawiązania połączenia używamy publicznych przekaźników sygnalizacyjnych (Nostr / relay WebSocket) oraz — w razie potrzeby — serwera TURN.' },
      ],
    },
    {
      heading: '3. Jakie dane są przetwarzane',
      blocks: [
        { p: 'Logowanie (OIDC): logujesz się przez zewnętrznego dostawcę (Google, Microsoft, Apple lub inny OIDC). Token tożsamości jest weryfikowany wyłącznie w Twojej przeglądarce. Odczytujemy z niego adres e-mail i imię i zapisujemy je lokalnie.' },
        { p: 'Lista dostępu (zaproszenia): twórca przestrzeni podpisuje listę adresów e-mail osób uprawnionych do dołączenia. Ta lista jest przesyłana P2P do uczestników, aby mogli weryfikować się nawzajem — oznacza to, że adresy e-mail zaproszonych osób są widoczne dla innych członków przestrzeni.' },
        { p: 'Adres IP: natura WebRTC sprawia, że łącząc się z uczestnikiem prywatnej przestrzeni lub rozmowy, Wasze przeglądarki wymieniają adresy IP; są one też widoczne dla operatorów przekaźników/TURN. Publiczna obecność i routing zaproszeń korzystają z kanału przekaźnika i nie tworzą połączenia WebRTC z każdą osobą online.' },
        { p: 'Obecność w przestrzeni: nasz przekaźnik może tymczasowo (do ok. 45 sekund od ostatniego sygnału) przetwarzać niejawny identyfikator przestrzeni, pseudonimowy identyfikator członka i zaszyfrowane dane obecności, aby lista online działała także podczas zestawiania połączenia P2P. Przekaźnik nie otrzymuje klucza potrzebnego do odszyfrowania tych danych.' },
        { p: 'Treści: wiadomości, pliki, obraz/dźwięk z połączeń wideo oraz nazwa i awatar — trafiają bezpośrednio do uczestników przestrzeni.' },
        { p: 'Dane w urządzeniu: historia i pliki (IndexedDB), preferencje, klucz kryptograficzny urządzenia, zapamiętane przestrzenie i zgody — w pamięci lokalnej Twojej przeglądarki. Opcjonalne parowanie synchronizuje wybrane dane bezpośrednio między wzajemnie zatwierdzonymi urządzeniami, gdy oba są online; sesje logowania, tokeny tożsamości i prywatne klucze nie są kopiowane.' },
        { note: 'Nie prowadzimy analityki, nie używamy pikseli śledzących ani reklam. Nie sprzedajemy danych.' },
      ],
    },
    {
      heading: '4. Podstawy prawne (RODO art. 6)',
      blocks: [
        { ul: [
          'Wykonanie usługi, o którą prosisz (art. 6 ust. 1 lit. b) — zestawienie połączenia P2P, weryfikacja logowania i listy dostępu.',
          'Prawnie uzasadniony interes (art. 6 ust. 1 lit. f) — bezpieczeństwo i działanie sieci P2P oraz kontrola dostępu do przestrzeni.',
          'Zgoda (art. 6 ust. 1 lit. a) — dostęp do kamery/mikrofonu, akceptacja Regulaminu.',
        ] },
      ],
    },
    {
      heading: '5. Kto może zobaczyć Twoje dane',
      blocks: [
        { ul: [
          'Inni uczestnicy przestrzeni — widzą Twoją nazwę, awatar, wiadomości, pliki i Twój adres IP; twórca i uczestnicy widzą też listę zaproszonych adresów e-mail.',
          'Operatorzy przekaźników i serwera TURN — metadane połączenia, krótkotrwałe pseudonimowe dane obecności i adresy IP.',
          'Dostawca logowania (Google/Microsoft/Apple/OIDC).',
          'Dostawca hostingu plików aplikacji — standardowe logi żądań.',
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
          'Hosting statyczny (np. Cloudflare).',
        ] },
        { p: 'Niektórzy dostawcy mogą przetwarzać dane poza EOG na podstawie mechanizmów RODO (np. standardowych klauzul umownych).' },
      ],
    },
    {
      heading: '7. Przechowywanie i usuwanie',
      blocks: [
        { p: 'Nie mamy centralnej kopii Twoich treści. Dane lokalne możesz usunąć w każdej chwili (wyloguj się, opuść lub wyczyść przestrzeń, wyczyść dane witryny). Kopie treści wysłanych innym pozostają na ich urządzeniach.' },
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
        { p: 'Połączenia P2P są szyfrowane (DTLS/SRTP), dostęp jest kryptograficznie ograniczony do zaproszonych adresów, a tożsamość peerów jest weryfikowana. Żaden system nie jest jednak w 100% bezpieczny.' },
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
    'Peerly is a peer-to-peer (P2P) team collaboration tool: messages, files, and calls travel directly between browsers over WebRTC. We run no server that stores your workspace content. Even so, using Peerly involves processing some personal data (such as IP addresses and the email addresses of invited people). This document explains it.',
  sections: [
    {
      heading: '1. Data controller',
      blocks: [
        { p: `The controller is ${m.controller} (an individual operating the Peerly service), ${m.country}. Privacy contact: ${m.privacyEmail}.` },
      ],
    },
    {
      heading: '2. Our approach: no application server',
      blocks: [
        { p: 'Peerly has no backend storing your messages, files, or workspace history. That data lives locally in your browser and is sent directly to invited participants. To establish connections we use public signaling relays (Nostr / WebSocket relay) and, when needed, a TURN server.' },
      ],
    },
    {
      heading: '3. What data is processed',
      blocks: [
        { p: 'Sign-in (OIDC): you sign in through a third-party provider (Google, Microsoft, Apple, or another OIDC provider). The ID token is verified entirely in your browser. From it we read your email and name and store them locally.' },
        { p: 'Allow-list (invitations): the workspace creator signs a list of email addresses permitted to join. This list is sent P2P to participants so they can verify one another — meaning invited people’s email addresses are visible to other members of the workspace.' },
        { p: 'IP address: by the nature of WebRTC, connecting to a participant in a private workspace or conversation means your browsers exchange IP addresses; they are also visible to relay/TURN operators. Public presence and invitation routing use a relay channel and do not create a WebRTC connection to every online user.' },
        { p: 'Workspace presence: our relay may temporarily process (for about 45 seconds after the latest signal) an opaque workspace identifier, a pseudonymous member identifier, and encrypted presence data so the online list works while P2P is still connecting. The relay does not receive the key needed to decrypt that data.' },
        { p: 'Content: messages, files, video-call audio/video, and your name and avatar go directly to workspace participants.' },
        { p: 'On-device data: history and files (IndexedDB), preferences, a device cryptographic key, remembered workspaces, and consents — in your browser’s local storage. Optional pairing syncs selected data directly between mutually approved devices while both are online; login sessions, identity tokens, and private keys are not copied.' },
        { note: 'We run no analytics, tracking pixels, or advertising. We do not sell data.' },
      ],
    },
    {
      heading: '4. Legal bases (GDPR Art. 6)',
      blocks: [
        { ul: [
          'Performance of the service you request (Art. 6(1)(b)) — establishing the P2P connection, verifying sign-in and the allow-list.',
          'Legitimate interests (Art. 6(1)(f)) — security and operation of the P2P network and workspace access control.',
          'Consent (Art. 6(1)(a)) — camera/microphone access, accepting the Terms.',
        ] },
      ],
    },
    {
      heading: '5. Who can see your data',
      blocks: [
        { ul: [
          'Other workspace participants — see your name, avatar, messages, files, and IP; the creator and members also see the list of invited email addresses.',
          'Relay and TURN operators — connection metadata, short-lived pseudonymous presence data, and IP addresses.',
          'The sign-in provider (Google/Microsoft/Apple/OIDC).',
          'The app’s static-hosting provider — standard request logs.',
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
          'Static hosting (e.g. Cloudflare).',
        ] },
        { p: 'Some providers may process data outside the EEA under GDPR transfer mechanisms (such as standard contractual clauses).' },
      ],
    },
    {
      heading: '7. Retention and deletion',
      blocks: [
        { p: 'We hold no central copy of your content. You can delete local data at any time (sign out, leave or clear a workspace, clear site data). Copies you sent to others remain on their devices.' },
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
        { p: 'P2P connections are encrypted (DTLS/SRTP), access is cryptographically restricted to invited addresses, and peer identity is verified. No system is 100% secure.' },
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
    { heading: '3. Charakter usługi', blocks: [{ p: 'Peerly to aplikacja P2P bez serwera aplikacji. Dostarczamy oprogramowanie „takie, jakie jest”. Nie przechowujemy ani nie moderujemy centralnie treści przestrzeni roboczych i nie gwarantujemy dostępności ani jakości połączeń.' }] },
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
      { p: 'Odpowiadasz za treści, które udostępniasz w przestrzeniach. Ponieważ treści przesyłane są bezpośrednio między uczestnikami, po ich wysłaniu nie mamy technicznej możliwości usunięcia ich z urządzeń odbiorców.' },
    ] },
    { heading: '7. Własność i licencja', blocks: [{ p: 'Kod aplikacji jest udostępniany na licencji open source (MIT). Zachowujesz prawa do własnych treści.' }] },
    { heading: '8. Wyłączenie gwarancji', blocks: [{ p: 'Usługa dostarczana jest „tak, jak jest”, bez jakichkolwiek gwarancji, w tym co do dostępności, bezpieczeństwa czy zachowania innych uczestników.' }] },
    { heading: '9. Ograniczenie odpowiedzialności', blocks: [{ p: 'W maksymalnym zakresie dozwolonym przez prawo nie ponosimy odpowiedzialności za szkody wynikające z korzystania z aplikacji, w tym za treści i zachowanie innych uczestników. Nie wyłącza to odpowiedzialności, której nie można wyłączyć zgodnie z prawem (np. wobec konsumentów).' }] },
    { heading: '10. Zgłaszanie nadużyć i treści nielegalnych', blocks: [{ p: `Nielegalne treści lub nadużycia zgłaszaj na ${m.abuseEmail}. Choć nie hostujemy treści centralnie, reagujemy w zakresie, w jakim jest to możliwe, i współpracujemy z właściwymi organami.` }] },
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
    { heading: '3. Nature of the service', blocks: [{ p: 'Peerly is a P2P app with no application server. We provide the software “as is”. We do not store or centrally moderate workspace content and do not guarantee availability or connection quality.' }] },
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
      { p: 'You are responsible for the content you share in workspaces. Because content is sent directly between participants, once sent we have no technical means to remove it from recipients’ devices.' },
    ] },
    { heading: '7. Ownership and license', blocks: [{ p: 'The app code is released under an open-source license (MIT). You keep the rights to your own content.' }] },
    { heading: '8. Disclaimer of warranties', blocks: [{ p: 'The service is provided “as is”, without warranties of any kind, including as to availability, security, or the conduct of other participants.' }] },
    { heading: '9. Limitation of liability', blocks: [{ p: 'To the maximum extent permitted by law, we are not liable for damages arising from use of the app, including the content and conduct of other participants. This does not exclude liability that cannot be excluded by law (e.g. towards consumers).' }] },
    { heading: '10. Reporting abuse and illegal content', blocks: [{ p: `Report illegal content or abuse to ${m.abuseEmail}. Although we do not host content centrally, we act to the extent we can and cooperate with the competent authorities.` }] },
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
