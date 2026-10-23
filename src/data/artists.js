// Demo artists and their clearance records. Only facts with a public source are entered.
// Anything we could not source stays empty, and the card shows "Unconfirmed".
//
// Clearance record shape:
//   publishing.controllers / master.controllers: [{ name, share (0-100 or null), source, url }]
//     name === null means a share whose controller we could not find.
//   publishing.songviewChecked: true | false | null (null = Songview not consulted)
//   manual: what the rights holder using the tool says about its own position. It overrides
//           public data and the card says "Manual".

export const DMN_AIR_SUPPLY = 'https://www.digitalmusicnews.com/2020/02/19/primary-wave-air-supply/';

const SRC = {
  umpgAshcroft: 'https://www.umusicpub.com/us/news/umpg-signs-richard-ashcroft-to-global-admin-deal',
  mbwAshcroft: 'https://www.musicbusinessworldwide.com/universal-signs-richard-ashcroft-to-global-music-publishing-admin-deal/',
  urbanHymnsMB: 'https://musicbrainz.org/release-group/3dd0c8e4-af53-3605-9c20-f27c7635fb60',
  urbanHymnsCredits: 'https://en.wikipedia.org/wiki/Urban_Hymns',
  urbanHymnsReissue: 'https://theseconddisc.com/2017/07/18/bitter-sweet-symphony-the-verves-urban-hymns-gets-box-set-edition/',
  bssBillboard: 'https://www.billboard.com/?p=8512911',
  bssUnderTheRadar: 'https://www.undertheradarmag.com/news/richard_ashcroft_gets_the_rights_back_to_bittersweet_symphony_from_the_roll',
  iggyBug: 'https://americansongwriter.com/bug-music-closes-two-big-deals/',
  bmgBug: 'https://variety.com/2011/music/news/bmg-acquires-publisher-bug-music-1118042654',
  lustForLifeMB: 'https://musicbrainz.org/release-group/15dc9ccf-e33b-3f4d-8c81-8346388d0b29',
  bowieYearsUMe: 'https://blabbermouth.net/news/iggy-pop-the-bowie-years-seven-cd-box-set-due-in-may',
  umpgClash: 'https://www.umusicpub.com/uk/Artists/T/The-Clash.aspx',
  strummerWarner: 'https://www.billboard.com/articles/business/publishing/8476534/warner-chappell-joe-strummer-solo-catalog-mescaleros',
  londonCallingLegacy: 'https://rollingstone.com/music/music-album-reviews/london-calling-25th-anniversary-legacy-edition-249357',
};

export const ARTISTS = {
  // Picked 2026-10-23 by the rule in scripts/find-sleepers.js after the quiet check moved to
  // Wikipedia page views (The Verve stopped qualifying: July 2025 at 2.32x its 3-year average).
  'the-clash': {
    key: 'the-clash',
    name: 'The Clash',
    wikipedia: 'The Clash', // English Wikipedia title for the quiet check
    pronoun: 'they',
    // Songs on UMPG's UK artist page. "Cut the Crap" (1985) is left out: Joe Strummer's share of it
    // went with his solo catalogue to Warner Chappell (Billboard).
    songs: ['The Magnificent Seven', 'Rock the Casbah', 'London Calling', 'Should I Stay or Should I Go'],
    clearanceNote: 'Universal Music Publishing Group lists these songs on its UK artist page; the page does not say whether it controls every share, so confirm before quoting. Songs from "Cut the Crap" are excluded: Joe Strummer’s share went to Warner Chappell with his solo catalogue. The recordings were reissued by Sony’s Legacy Recordings; the current owner is inferred from that, not from a (P) line.',
    clearance: {
      publishing: {
        controllers: [
          { name: 'Universal Music Publishing Group', role: 'listed by', share: null, source: 'UMPG artist page', url: SRC.umpgClash },
        ],
        songviewChecked: null,
      },
      master: {
        controllers: [
          { name: 'Sony Music (Legacy Recordings reissues)', share: null, source: 'Legacy reissue, Rolling Stone 2004', url: SRC.londonCallingLegacy },
        ],
      },
      manual: null,
    },
    sources: [SRC.umpgClash, SRC.strummerWarner, SRC.londonCallingLegacy],
    royaltyStatements: null,
  },
  'the-verve': {
    key: 'the-verve',
    name: 'The Verve',
    wikipedia: 'The Verve', // English Wikipedia title for the quiet check
    pronoun: 'they',
    // Songs credited solely to Richard Ashcroft on Urban Hymns (album credits). "Bitter Sweet Symphony"
    // is left out on purpose: reports differ on whether ABKCO kept a publishing share after 2019.
    songs: ['Lucky Man', "The Drugs Don't Work", 'Sonnet', 'Space and Time'],
    clearanceNote: 'Applies to songs written by Richard Ashcroft alone. "Bitter Sweet Symphony" is unconfirmed: Billboard (2019) says ABKCO kept the publishing; Under the Radar says Ashcroft got it back.',
    clearance: {
      publishing: {
        controllers: [
          { name: 'Universal Music Publishing Group', role: 'administered by', share: null, source: 'UMPG 2020', url: SRC.umpgAshcroft, quote: 'signed to an exclusive, global administration deal' },
        ],
        songviewChecked: null,
      },
      master: {
        controllers: [
          { name: 'Hut Recordings / Virgin (Universal reissues since 2017)', share: null, source: '(P) line via MusicBrainz', url: SRC.urbanHymnsMB },
        ],
      },
      manual: null,
    },
    sources: [SRC.umpgAshcroft, SRC.mbwAshcroft, SRC.urbanHymnsCredits, SRC.urbanHymnsMB, SRC.urbanHymnsReissue, SRC.bssBillboard, SRC.bssUnderTheRadar],
    royaltyStatements: null,
  },
  'iggy-pop': {
    key: 'iggy-pop',
    name: 'Iggy Pop',
    wikipedia: 'Iggy Pop', // English Wikipedia title for the quiet check
    pronoun: 'he',
    songs: ['Lust for Life', 'The Passenger'],
    clearanceNote: 'Iggy Pop’s solo catalogue went to Bug Music in 2008; BMG bought Bug Music in 2011. His best-known songs have co-writers (David Bowie on "Lust for Life", Ricky Gardiner on "The Passenger") whose publishers we could not confirm.',
    clearance: {
      publishing: {
        controllers: [
          { name: 'BMG (bought Bug Music, his publisher, in 2011)', share: null, source: 'American Songwriter 2008, Variety 2011', url: SRC.iggyBug },
          { name: null, share: null, source: null, url: null, note: 'Co-writers’ shares (David Bowie, Ricky Gardiner) have no confirmed publisher. Confirm before knocking.' },
        ],
        songviewChecked: null,
      },
      master: {
        controllers: [
          { name: 'RCA (1977 release; 2020 reissues through UMe)', share: null, source: '(P) line via MusicBrainz', url: SRC.lustForLifeMB },
        ],
      },
      manual: null,
    },
    sources: [SRC.iggyBug, SRC.bmgBug, SRC.lustForLifeMB, SRC.bowieYearsUMe],
    royaltyStatements: null,
  },
  'air-supply': {
    key: 'air-supply',
    name: 'Air Supply',
    wikipedia: 'Air Supply', // English Wikipedia title for the quiet check
    pronoun: 'they',
    songs: ['All Out of Love', 'Making Love Out of Nothing at All', 'Lost in Love', 'Even the Nights Are Better', 'The One That You Love'],
    clearance: {
      publishing: {
        controllers: [
          { name: 'Primary Wave', share: 70, source: 'DMN 2020', url: DMN_AIR_SUPPLY, quote: 'a 70% stake in the song catalog of Air Supply' },
          { name: null, share: 30, source: null, url: null },
        ],
        songviewChecked: null,
      },
      master: {
        controllers: [
          { name: 'Sony Music and other labels', share: null, source: 'DMN 2020', url: DMN_AIR_SUPPLY, quote: 'Several record labels, including Sony Music, own the master rights to Air Supply\'s most prominent works' },
        ],
        multipleControllers: true,
      },
      manual: {
        // Demo persona: the user is the holder of the 70% song-catalog stake.
        persona: 'You hold the 70% song-catalog stake.',
        publishingPct: 70,
        masterPct: 0,
        confirmedMasterPath: 'needs-consent',
        enteredAt: '2026-10-22',
      },
    },
    royaltyStatements: null, // fallback "quiet" basis; filled by the rights holder
  },
  'culture-club': {
    key: 'culture-club',
    name: 'Culture Club',
    wikipedia: 'Culture Club', // English Wikipedia title for the quiet check
    pronoun: 'they',
    songs: ['Karma Chameleon', 'Do You Really Want to Hurt Me', 'Time (Clock of the Heart)', 'Church of the Poison Mind'],
    clearance: { publishing: { controllers: [], songviewChecked: null }, master: { controllers: [] }, manual: null },
    royaltyStatements: null,
  },
};

export const DEFAULT_ARTIST = 'the-clash';
