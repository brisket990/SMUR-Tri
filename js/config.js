// ============================================================
//  Réglages globaux — tout ce qu'un formateur peut vouloir ajuster
// ============================================================

export const CONFIG = {
  // --- Scénarios ---
  //  Chaque scénario = un dossier scenarios/<id>/ avec scenario.json (plan, zones,
  //  sac, renforts, briefing…) ; la liste est générée par outils/chiffrer.py.
  scenariosIndex: 'scenarios/index.json',
  scenariosDir: 'scenarios/',
  cardBackSrc: 'images/verso.jpg',     // verso par défaut (un scénario peut définir le sien)
  faceDownUntilSeen: true,             // cartes face cachée tant que non examinées

  // --- Placement des cartes ---
  seed: null,                 // null = disposition aléatoire ; rejouer une partie : champ « N° de partie » du menu
  cardWidthRatio: 0.018,      // largeur d'une carte au sol / largeur du plan
  cardMaxRotationDeg: 20,     // désordre visuel des cartes
  cardMinSpacing: 0.7,        // espacement mini entre cartes (× largeur carte)

  // --- Chargement ---
  thumbWidth: 200,            // résolution des miniatures dessinées sur le plan
  loadConcurrency: 6,

  // --- Caméra ---
  zoom: { min: 0.8, max: 12 },   // multiples du zoom "plan entier"

  // --- Lampe de poche (en pixels écran) ---
  flashlight: {
    radius: 280,       // rayon du halo
    darkness: 0.62,    // opacité de la pénombre hors du halo (0 = aucune, 1 = noir)
    warmth: 0.10,      // lueur chaude au centre
    follow: 16,        // vitesse de suivi du curseur (plus haut = plus sec)
  },

  // --- Temps ---
  clock: {
    timeScale: 1,          // 1 = temps réel ; 2 = deux fois plus vite
    pauseOnModal: false,   // en tri réel le temps ne s'arrête pas
  },

  // --- Fiches victimes ---
  //  mode : 'generated' = dessinées à partir du texte (silhouette + blessures)
  //         'images'    = fiches PNG d'origine (chiffrées par outils/chiffrer.py)
  //         'auto'      = PNG si présente, sinon fiche générée
  //  templatesDir : vos fiches vierges modele-homme.jpg, modele-femme.jpg, modele-enfant.jpg, modele-bebe.jpg
  //  (bébé < 3 ans, enfant < 13 ans, sinon selon le sexe)
  cards: { mode: 'generated', title: 'SMUR BEAUJON', templatesDir: 'img/fiches/' },

  // --- Sac médical : gestes du premier tour ---
  //  initial / logistics = valeurs par défaut ; chaque scenario.json peut définir
  //  "stock", "stockFor" (nombre de victimes de référence) et "logistics".
  //  consumable: false → geste sans matériel ; group: 'position' → positions exclusives
  items: {
    tourniquet:  { label: 'Garrot tactique',        short: 'Garrot',       initial: 9 },
    compressive: { label: 'Pansement compressif',   short: 'Compressif',   initial: 9 },
    hemostatic:  { label: 'Pansement hémostatique', short: 'Hémostatique', initial: 9 },
    chestSeal:   { label: 'Pansement 3 côtés',      short: '3 côtés',      initial: 3 },
    needle:      { label: "Stylo d'exsufflation",   short: 'Exsufflation', initial: 3 },
    blanket:     { label: 'Couverture de survie',   short: 'Couverture',   initial: 9 },
    oxygen:      { label: 'Oxygène (bouteille)',    short: 'O2',           initial: 2 },
    // positions d'attente : sans matériel, une seule à la fois (group: 'position')
    pls:         { label: 'PLS',                         short: 'PLS',          consumable: false, group: 'position' },
    posSit:      { label: 'Assis / demi-assis',          short: 'Assis',        consumable: false, group: 'position' },
    posLegs:     { label: 'Allongé, jambes surélevées',  short: 'Jambes haut',  consumable: false, group: 'position' },
    posFlexed:   { label: 'Allongé, jambes fléchies',    short: 'Jambes fléch.', consumable: false, group: 'position' },
    posFlat:     { label: 'À plat dos, jambes tendues',  short: 'À plat',       consumable: false, group: 'position' },
  },

  // --- Renforts logistiques (minutes de jeu) ---
  logistics: [
    { atMin: 12, label: 'VL LOG 1', items: { tourniquet: 10, compressive: 15, hemostatic: 6, chestSeal: 8, needle: 4, blanket: 20 } },
    { atMin: 25, label: 'VL LOG 2', items: { tourniquet: 15, compressive: 20, hemostatic: 8, chestSeal: 10, needle: 6, blanket: 30 } },
  ],

  // --- Menu de départ ---
  victimCount: { min: 15, max: 150, step: 5, default: 50 },   // par défaut ; scenario.json → "victims"
  //  Mode « Hasard total » : scénario et nombre de victimes tirés au sort
  randomMode: true,
  //  Sac et renforts ajustés au nombre de victimes (valeurs ci-dessus = 150 victimes)
  scaleStockWithVictims: true,

  // --- Accès et chiffrement (voir README et outils/chiffrer.py) ---
  //  Fiches et données de tri sont chiffrées (AES-256) : seul un code valide
  //  permet de les lire. Sans code valide, chaque carte retournée révèle une
  //  menace et le joueur est tué.
  access: {
    keysSrc: 'data/keys.json',        // clé des fichiers, protégée par chaque code
    threatSrc: 'images/menace.png',   // image facultative ; sinon une carte "menace" est dessinée
    revealClicks: 3,                  // clics rapides sur la carte du menu pour faire apparaître le champ code
    decoys: [2, 3],                   // sans code : nombre de fiches leurres jouables (tiré entre les deux) avant la menace
  },


  // --- Briefing de lancement ---
  briefing: {
    typeSpeed: 18,        // ms par caractère (effet machine à écrire) ; 0 = texte immédiat
    voice: true,          // bouton « Écouter » (synthèse vocale du navigateur)
  },

  // --- Ambiance : bulles de BD et téléphones (options activables dans le menu) ---
  ambience: {
    defaults: { bubbles: true, phones: true, sound: true, outside: true },
    volume: 0.6,
    //  Vos sonneries MP3 : déposez-les dans jeu/SMUR-Tri/sons/ sous les noms
    //  sonnerie-01.mp3, sonnerie-02.mp3, sonnerie-03.mp3… (numérotation continue,
    //  jusqu'à 30). Elles sont détectées automatiquement.
    ringtoneDir: 'sons/',
    ringtoneMax: 30,
    fileShare: 0.8,           // part des téléphones qui utilisent vos MP3 (le reste : sonneries synthétisées)
    maxFileSec: 12,           // durée max d'une lecture de MP3 avant de la relancer
    talk: { intervalSec: [1.5, 4], lifeSec: [3, 5], maxConcurrent: 5 },   // appels à l'aide, cris, pleurs
    phones: {
      firstAfterSec: 15,      // premier téléphone
      startIntervalSec: 20,   // intervalle moyen au début…
      minIntervalSec: 2,      // …qui se réduit jusqu'à ce minimum
      accelPerMin: 2,         // secondes gagnées par minute de jeu
      addOneEveryMin: 2,      // un téléphone simultané de plus toutes les N minutes
      maxConcurrent: 10,
      ringSec: [8, 16],       // durée d'une sonnerie avant « appel manqué »
    },
  },

  // --- Validation du tri ---
  //  Doctrine SSE : une victime garrottée est au minimum UA
  garrotedIsUA: true,
  //  false = mode exercice : aucun retour sur la justesse du tri/des gestes avant le bilan
  immediateFeedback: false,
};

// Catégories de tri
// (mêmes codes que le cartouche "DÉCISION DE TRIAGE SMUR" des fiches)
export const TRIAGE = {
  BLACK:  { label: 'UD — Urgence dépassée', short: 'UD',       color: '#6b6b6b' },
  RED:    { label: 'UA — Urgence absolue',  short: 'UA',       color: '#d6322f' },
  YELLOW: { label: 'UR — Urgence relative', short: 'UR',       color: '#f6bf2e' },
  GREEN:  { label: 'Impliqué',              short: 'Impliqué', color: '#3b8f3b' },
};

// État physiologique affiché sur le plan
export const STATUS = {
  STABLE:   'STABLE',
  CRITICAL: 'CRITICAL',
  DEAD:     'DEAD',
};
