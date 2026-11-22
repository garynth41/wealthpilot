// Built-in merchant library (0.31.0): what a payee most likely is, worked out on the device — no network, nothing leaves the phone.
// Two tiers: BRANDS (a named merchant: "kroger", "shell", "netflix") and WORDS (a telling word in a bank description: "pharmacy",
// "pizza", "vet"). A brand is a confident answer unless the brand sells across several budget lines (Walmart, Amazon, Costco, Target),
// where it is only a likely one. Each answer is a CONCEPT ("groceries", "fuel"), which is then matched to the household's own category
// by name — households rename and add categories, so the library never stores a category id.
// Pure functions; the suggestion engine (lib/rules suggest) calls libraryCategory as its last resort, after the household's own rules and history.
import { readsAsTransfer } from './dedupe'
import type { Category } from '../app/data/types'
import { merchantKey } from './intelligence'

export type Concept =
  | 'groceries' | 'dining' | 'coffee' | 'fuel' | 'transit' | 'auto_service' | 'auto_insurance' | 'rent' | 'electric' | 'gas_utility' | 'water'
  | 'internet' | 'phone' | 'subscriptions' | 'pharmacy' | 'medical' | 'health_insurance' | 'gym' | 'shopping' | 'home' | 'personal_care'
  | 'entertainment' | 'travel' | 'pets' | 'kids' | 'education' | 'gifts' | 'insurance' | 'taxes' | 'fees' | 'loan'
  | 'paycheck' | 'benefits' | 'interest_income' | 'side_income' | 'other_income'
export type Confidence = 'high' | 'medium'
export interface LibraryMatch { concept: Concept; confidence: Confidence; matched: string }

/** Lower-case, letters and digits only, single spaces — keeps the words after a `*` or `#` that merchantKey drops ("PAYPAL *NETFLIX"). */
export const plain = (s?: string | null) => { const t = String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' '); while (t.length > 1 && WRAPPERS.has(t[0])) t.shift(); return ' ' + t.join(' ') + ' ' }
/** Words a bank or a payment processor puts in front of the real merchant ("SQ *BLUE DOOR CAFE", "PAYPAL *NETFLIX", "POS DEBIT KROGER"). */
const WRAPPERS = new Set('sq|paypal|pp|sp|pos|debit|credit|purchase|checkcard|card|recurring|visa|mastercard|ach|web|online|pmt|payment|withdrawal|pending|dd|in'.split('|'))

// ---- named merchants: confident ----
const BRANDS: Partial<Record<Concept, string>> = {
  groceries: 'kroger|aldi|publix|safeway|albertsons|whole foods|wholefds|trader joes|trader joe s|meijer|giant eagle|heb|h e b|wegmans|food lion|stop and shop|stop shop|shoprite|winn dixie|harris teeter|sprouts|fresh market|fresh thyme|piggly wiggly|save a lot|food 4 less|ralphs|vons|fred meyer|king soopers|frys food|smiths food|hy vee|hyvee|winco|market basket|price chopper|hannaford|giant food|acme markets|jewel osco|lidl|instacart|shipt|fresh direct|freshdirect|hello fresh|hellofresh|blue apron|home chef|thrive market|grocery outlet|food city|ingles|bi lo|schnucks|dillons|pick n save|marianos|stater bros|raleys|weis markets|tops markets|big y|iga|natural grocers|earth fare|99 ranch|h mart|hmart|patel brothers|saraga|farmers market|carniceria|supermercado',
  dining: 'mcdonalds|mcdonald s|burger king|wendys|taco bell|chick fil a|chickfila|chipotle|subway|kfc|popeyes|arbys|sonic drive|dairy queen|five guys|in n out|shake shack|whataburger|culvers|white castle|jack in the box|carls jr|hardees|raising canes|zaxbys|wingstop|buffalo wild wings|bww|dominos|domino s|pizza hut|papa johns|papa murphys|little caesars|marcos pizza|jets pizza|donatos|panera|jimmy johns|jersey mikes|firehouse subs|potbelly|qdoba|moes southwest|panda express|pf changs|olive garden|red lobster|outback|texas roadhouse|longhorn steak|applebees|chilis|tgi fridays|red robin|cheesecake factory|cracker barrel|ihop|dennys|waffle house|bob evans|first watch|noodles and co|sweetgreen|cava|el pollo loco|del taco|steak n shake|skyline chili|golden corral|bjs restaurant|bonefish|carrabbas|maggianos|benihana|hooters|bojangles|churchs chicken|doordash|door dash|grubhub|grub hub|uber eats|ubereats|postmates|seamless|caviar|eatstreet|toasttab|tst|chowbus|slice pizza|condado|cameron mitchell|city barbeque|roosters|hot head burritos|piada|northstar cafe|melt bar',
  coffee: 'starbucks|dunkin|dutch bros|tim hortons|peets|caribou coffee|biggby|scooters coffee|krispy kreme|crumbl|insomnia cookies|jamba|smoothie king|tropical smoothie|baskin robbins|cold stone|graeters|jenis|coffee bean|philz|blue bottle|la colombe|einstein bros|brueggers|auntie annes|cinnabon|pretzelmaker|boba|kung fu tea|gong cha|sweet frog|menchies|yogurtland|ritas italian ice',
  fuel: 'shell|exxon|exxonmobil|mobil|chevron|texaco|bp|sunoco|marathon|speedway|circle k|valero|phillips 66|conoco|citgo|76|arco|sinclair|murphy usa|murphy express|quiktrip|qt|wawa|sheetz|racetrac|raceway|caseys|kwik trip|kwik star|loves travel|pilot travel|flying j|ta travel|maverik|cumberland farms|getgo|thorntons|kum and go|bucees|buc ees|holiday station|costco gas|costco fuel|sams fuel|sams club fuel|kroger fuel|meijer gas|giant eagle fuel|safeway fuel|heb fuel|walmart fuel|bjs fuel|turkey hill|united dairy farmers|udf|duchess|certified oil|gulf oil|stewarts shops|royal farms|7 eleven fuel|chargepoint|electrify america|evgo|tesla supercharger|blink charging',
  transit: 'uber|lyft|amtrak|greyhound|megabus|flixbus|mta|metrocard|omny|cta|ventra|bart|clipper|wmata|smartrip|septa|mbta|charlie card|metra|njtransit|nj transit|lirr|metro north|caltrain|marta|cota|rta|dart|trimet|sound transit|orca|e zpass|ezpass|ez pass|ipass|sunpass|fastrak|txtag|ntta|peach pass|ohio turnpike|pa turnpike|parkmobile|spothero|paybyphone|laz parking|sp plus|impark|ace parking|parkwhiz|premium parking|passport parking|lime|bird rides|spin scooter|citi bike|divvy|cogo|capital bikeshare|zipcar|turo|yellow cab|curb taxi|via rides',
  auto_service: 'jiffy lube|valvoline|take 5 oil|grease monkey|midas|meineke|firestone|goodyear|discount tire|tire discounters|ntb|pep boys|monro|mavis|big o tires|les schwab|tires plus|belle tire|town fair tire|autozone|auto zone|oreilly auto|o reilly auto|advance auto|napa auto|carquest|safelite|maaco|caliber collision|gerber collision|aamco|christian brothers auto|mr tire|tire rack|car wash|mister car wash|moo moo|zips car wash|take 5 car wash|quick quack|tommys express|bmv|dmv|bureau of motor|dept of motor|emissions test|aaa membership|aaa ohio',
  auto_insurance: 'geico|progressive|state farm|allstate|liberty mutual|farmers ins|nationwide|usaa ins|esurance|the general|root insurance|erie insurance|american family ins|travelers ins|safeco|mercury insurance|metromile|grange insurance|westfield insurance|auto owners|kemper|bristol west|direct auto|safe auto|elephant insurance|clearcover',
  electric: 'duke energy|aep|american electric power|aep ohio|firstenergy|first energy|ohio edison|toledo edison|illuminating company|dominion energy|southern california edison|sce|pg and e|pge|pacific gas|con edison|coned|con ed|national grid|eversource|xcel energy|entergy|georgia power|alabama power|florida power|fpl|tampa electric|teco|duke power|dte energy|consumers energy|comed|commonwealth edison|ameren|pseg|pse and g|ppl electric|peco|bge|baltimore gas|pepco|delmarva|oncor|txu|reliant|centerpoint|aps|arizona public|srp|salt river project|nv energy|rocky mountain power|puget sound energy|portland general|idaho power|westar|evergy|oge|ladwp|sdge|san diego gas|smud|seattle city light|austin energy|cps energy|green mountain energy|direct energy|igs energy|constellation|energy harbor|dayton power|aes ohio|buckeye power|south central power|union rural electric|consolidated electric',
  gas_utility: 'columbia gas|dominion east ohio|enbridge gas|centerpoint energy gas|atmos energy|nicor gas|peoples gas|socalgas|southern california gas|southwest gas|piedmont natural|washington gas|national fuel|spire|laclede|vectren|nipsco|new jersey natural|south jersey gas|nw natural|cascade natural|questar|intermountain gas|black hills energy|ugi|suburban propane|amerigas|ferrellgas|propane',
  water: 'water dept|water department|water works|waterworks|city water|water utility|water and sewer|sewer|aqua america|aqua ohio|american water|del co water|delco water|waste management|wm com|republic services|rumpke|waste connections|gfl environmental|casella|recology|trash|refuse|sanitation|public utilities|city of columbus util|city utilities|municipal util',
  internet: 'comcast|xfinity|spectrum|charter comm|cox comm|att internet|at and t internet|att uverse|verizon fios|fios|frontier comm|centurylink|lumen|optimum|altice|suddenlink|mediacom|wow internet|wideopenwest|breezeline|rcn|astound|google fiber|starlink|hughesnet|viasat|windstream|kinetic|earthlink|tds telecom|metronet|ziply|sonic net|cincinnati bell|altafiber|directv|dish network|sling tv',
  phone: 'verizon wireless|verizon|vzw|t mobile|tmobile|at and t|att|sprint|cricket wireless|metro by t|metropcs|boost mobile|mint mobile|visible|us cellular|uscellular|straight talk|tracfone|consumer cellular|google fi|xfinity mobile|spectrum mobile|republic wireless|ting|red pocket|total wireless|simple mobile|h2o wireless|ultra mobile|tello|us mobile',
  subscriptions: 'netflix|hulu|disney plus|disneyplus|disney|hbo|max com|hbomax|paramount plus|paramount|peacock|apple tv|appletv|amazon prime|prime video|primevideo|youtube premium|youtubepremium|youtube tv|youtubetv|youtube|spotify|apple music|pandora|sirius|siriusxm|tidal|audible|kindle|kindle unlimited|apple com bill|apple bill|itunes|icloud|google one|google storage|google play|dropbox|microsoft 365|microsoft office|msft|office 365|adobe|canva|notion|evernote|1password|lastpass|dashlane|nordvpn|expressvpn|surfshark|chatgpt|openai|anthropic|claude ai|github|linkedin premium|nytimes|new york times|ny times|wsj|wall street journal|washington post|wapo|the atlantic|economist|substack|patreon|medium com|crunchyroll|espn plus|espn|fubo|philo|discovery plus|amc plus|starz|showtime|britbox|curiosity stream|masterclass|duolingo|headspace|calm com|calm|noom|weight watchers|ww intl|strava|peloton app|xbox|playstation|nintendo|steam games|steamgames|epic games|twitch|ring com|ring protect|nest aware|simplisafe|adt security|vivint|lifelock|norton|mcafee|malwarebytes|grammarly|zoom us|slack|squarespace|wix com|godaddy|namecheap|ancestry|23andme|costco membership|sams club membership|amazon music|amazon kids|blue apron sub|dollar shave|harrys|birchbox|ipsy|fabfitfun|stitch fix|chewy autoship|bark box|barkbox',
  pharmacy: 'cvs|walgreens|rite aid|riteaid|duane reade|walmart pharmacy|kroger pharmacy|costco pharmacy|sams pharmacy|publix pharmacy|meijer pharmacy|heb pharmacy|giant eagle pharmacy|express scripts|optumrx|optum rx|caremark|goodrx|capsule pharmacy|amazon pharmacy|pillpack|cost plus drugs|discount drug mart|medicine shoppe|health mart',
  medical: 'ohiohealth|ohio health|osu wexner|osumc|ohio state medical|mount carmel|nationwide childrens|cleveland clinic|mayo clinic|kaiser|sutter health|dignity health|hca|ascension|trinity health|commonspirit|providence health|advocate|northwell|nyu langone|mass general|johns hopkins|upmc|geisinger|intermountain|banner health|baylor scott|memorial hermann|atrium health|novant|adventhealth|bon secours|mercy health|premier health|kettering health|uc health|christ hospital|labcorp|quest diagnostics|minuteclinic|minute clinic|urgent care|medexpress|concentra|teladoc|mdlive|zocdoc|one medical|planned parenthood|aspen dental|western dental|smile direct|invisalign|lenscrafters|pearle vision|visionworks|warby parker|americas best|eyeglass world|1 800 contacts|1800contacts|myeyedr|eyemart|physical therapy|athletico|chiropractic|the joint chiro|dermatology|orthopedic|pediatrics|radiology|anesthesia|ambulance|betterhelp|talkspace|cerebral|hims|hers health|ro co|nurx',
  health_insurance: 'anthem|blue cross|bluecross|bcbs|aetna|cigna|unitedhealthcare|united healthcare|uhc|humana|kaiser premium|medical mutual|molina|oscar health|ambetter|caresource|healthcare gov|cobra premium|delta dental|metlife dental|guardian dental|vsp vision|eyemed',
  gym: 'planet fitness|planet fit|la fitness|lifetime fitness|life time fit|anytime fitness|24 hour fitness|golds gym|crunch fitness|equinox|orangetheory|orange theory|ymca|ywca|peloton|crossfit|f45|pure barre|barrys bootcamp|soulcycle|cyclebar|club pilates|corepower|yoga six|title boxing|9round|blink fitness|snap fitness|esporta|workout anytime|youfit|retro fitness|rock climbing|chuze fitness|classpass|mindbody',
  shopping: 'kohls|macys|nordstrom|jcpenney|jc penney|dillards|belk|tj maxx|tjmaxx|marshalls|ross stores|ross dress|burlington|old navy|gap|banana republic|h and m|zara|uniqlo|forever 21|american eagle|aerie|abercrombie|hollister|express|j crew|jcrew|lululemon|athleta|nike|adidas|under armour|foot locker|finish line|dsw|famous footwear|shoe carnival|payless|skechers|vans|converse|victoria s secret|victorias secret|bath and body|best buy|bestbuy|apple store|micro center|microcenter|gamestop|b and h photo|newegg|ebay|etsy|shein|temu|aliexpress|wish com|wayfair|overstock|qvc|hsn|zulily|poshmark|mercari|thredup|five below|dollar tree|dollar general|family dollar|big lots|ollies|tuesday morning|homegoods|home goods|at home|pier 1|world market|michaels|hobby lobby|joann|jo ann|barnes and noble|books a million|half price books|dicks sporting|academy sports|rei|bass pro|cabelas|scheels|party city|spirit halloween|hot topic|claires|sunglass hut|kay jewelers|zales|jared|pandora jewel|tiffany|coach|kate spade|michael kors|sephora|ulta|levis|carters|oshkosh|gymboree|childrens place|torrid|lane bryant|mens wearhouse|jos a bank|duluth trading|ll bean|lands end|eddie bauer|columbia sportswear|patagonia|north face|ikea',
  home: 'home depot|homedepot|lowes|menards|ace hardware|true value|harbor freight|tractor supply|sherwin williams|benjamin moore|floor and decor|lumber liquidators|ll flooring|bed bath|container store|crate and barrel|pottery barn|williams sonoma|west elm|restoration hardware|ashley furniture|rooms to go|bobs discount|value city furniture|la z boy|mattress firm|sleep number|casper|purple mattress|roto rooter|mr rooter|terminix|orkin|truegreen|trugreen|scotts lawn|lawn care|landscap|plumbing|hvac|heating and cooling|roofing|electrician|handyman|angi|homeadvisor|thumbtack|taskrabbit|stanley steemer|servpro|merry maids|molly maid|culligan|sunrun|vivint solar|nursery and garden|garden center|oakland nursery|strader',
  personal_care: 'great clips|supercuts|sport clips|fantastic sams|cost cutters|hair cuttery|regis salon|smartstyle|floyds barber|barber|barbershop|hair salon|salon|nail|nails|spa|massage envy|hand and stone|elements massage|european wax|waxing|drybar|sally beauty|lash|tanning|sun tan city|dry clean|drycleaner|dry cleaner|laundromat|laundry|tide cleaners|tailor|alterations',
  entertainment: 'amc theatres|amc theaters|amc|regal cinema|regal|cinemark|marcus theatres|alamo drafthouse|fandango|atom tickets|ticketmaster|live nation|livenation|stubhub|seatgeek|vivid seats|axs|eventbrite|dave and busters|main event|topgolf|top golf|bowlero|amf bowling|round one|chuck e cheese|sky zone|urban air|escape room|six flags|cedar point|kings island|disneyland|disney world|walt disney world|universal studios|universal orlando|seaworld|busch gardens|legoland|great wolf lodge|zoo|aquarium|museum|cosi|planetarium|botanical|conservatory|mini golf|putt putt|golf course|golf club|ski resort|lift ticket|state park|national park|recreation gov|bowling|arcade|laser tag|paintball|go kart|trampoline|concert|theater|theatre|symphony|opera|ballet|comedy club|casino|lottery|draftkings|fanduel|betmgm|book of the month',
  travel: 'delta air|delta|united air|united airlines|american air|american airlines|southwest air|southwest|jetblue|alaska air|spirit air|frontier air|allegiant|hawaiian air|air canada|british airways|lufthansa|air france|klm|emirates|qatar airways|virgin atlantic|aer lingus|icelandair|westjet|breeze airways|sun country|marriott|hilton|hyatt|ihg|holiday inn|hampton inn|courtyard|residence inn|fairfield inn|springhill|doubletree|embassy suites|homewood suites|sheraton|westin|w hotel|ritz carlton|four seasons|best western|wyndham|days inn|super 8|la quinta|ramada|comfort inn|quality inn|choice hotels|motel 6|red roof|extended stay|drury|omni hotel|loews hotel|kimpton|airbnb|vrbo|homeaway|booking com|expedia|hotels com|priceline|kayak|orbitz|travelocity|hopper|tripadvisor|viator|hertz|avis|budget rent|enterprise rent|national car|alamo rent|dollar rent|thrifty|sixt|carnival cruise|royal caribbean|norwegian cruise|disney cruise|princess cruise|celebrity cruise|tsa precheck|global entry|clear me|passport|travel insurance|allianz travel|airport parking|the parking spot|duty free|rail europe|eurostar|trainline',
  pets: 'petsmart|petco|chewy|pet supplies plus|petland|pet valu|banfield|vca animal|vet|veterinary|animal hospital|animal clinic|animal care|pet hospital|petmed|1800petmeds|rover com|rover|wag|barkbox|farmers dog|ollie pets|nom nom|trupanion|healthy paws|embrace pet|nationwide pet|lemonade pet|dog groom|pet groom|grooming|kennel|boarding|doggy daycare|dog daycare|camp bow wow|dogtopia',
  kids: 'toys r us|build a bear|lego|american girl|disney store|buy buy baby|buybuy baby|babies r us|carters|pampers|huggies|gerber|enfamil|similac|once upon a child|kid to kid|little gym|gymboree play|my gym|kumon|mathnasium|sylvan|code ninjas|school lunch|myschoolbucks|payschools|lunchtime|scholastic|girl scouts|boy scouts|scouts bsa|little league|youth sports|ymca camp|summer camp|dance studio|dance academy|swim lessons|goldfish swim|music lessons|school of rock|karate|taekwondo|martial arts|gymnastics',
  education: 'tuition|university|college|community college|school district|bright horizons|kindercare|primrose school|goddard school|learning care|la petite|childcare|child care|daycare|day care|preschool|montessori|care com|sittercity|urbansitter|nelnet|navient|mohela|great lakes|fedloan|aidvantage|edfinancial|sallie mae|coursera|udemy|udacity|edx|skillshare|linkedin learning|pluralsight|codecademy|khan academy|chegg|quizlet|pearson|mcgraw hill|cengage|textbook|bookstore|college board|act inc|ets gre|toefl|kaplan|princeton review',
  gifts: 'red cross|salvation army|goodwill donation|united way|unicef|st jude|st judes|habitat for humanity|feeding america|food bank|doctors without borders|world vision|compassion intl|samaritans purse|wounded warrior|aspca|humane society|planned giving|gofundme|givebutter|donorbox|actblue|winred|tithe|tithely|pushpay|church|parish|ministry|ministries|synagogue|temple|mosque|masjid|donation|charity|charitable|foundation|npr|pbs|wosu|wikipedia|wikimedia|hallmark|1 800 flowers|1800flowers|ftd|proflowers|edible arrangements|shutterfly|snapfish|minted|things remembered|harry and david',
  insurance: 'northwestern mutual|new york life|mass mutual|massmutual|prudential|lincoln financial|guardian life|pacific life|transamerica|primerica|globe life|colonial life|aflac|mutual of omaha|john hancock|principal life|securian|ladder life|haven life|ethos life|bestow|lemonade insurance|lemonade ins|hippo insurance|assurant|american home shield|choice home warranty|renters insurance|homeowners ins|umbrella policy|life insurance|term life',
  taxes: 'irs|us treasury|usataxpymt|irs treas|treasury 310|state tax|dept of taxation|department of taxation|ohio dept of tax|ohio taxation|franchise tax|comptroller|dept of revenue|department of revenue|county treasurer|county auditor|property tax|rita|ccita|city income tax|income tax|turbotax|turbo tax|intuit tt|h and r block|hr block|hrblock|taxact|taxslayer|freetaxusa|jackson hewitt|liberty tax|cash app taxes',
  fees: 'overdraft|nsf fee|insufficient funds|monthly service fee|maintenance fee|service charge|atm fee|atm withdrawal fee|foreign transaction|late fee|annual fee|interest charge|finance charge|wire fee|returned item|stop payment|account fee|paper statement fee|cash advance fee|balance transfer fee',
  rent: 'rent payment|rentpayment|rent pmt|apartment|apartments|apts|property management|property mgmt|realty|leasing office|rentcafe|rent cafe|appfolio|buildium|yardi|avail co|zillow rental|zillow rent|cozy services|paylease|zego|entrata|residentportal|resident portal|clickpay|flex rent|flexible finance|getflex|bilt rewards|bilt rent|mortgage|mtg pmt|mtg payment|rocket mortgage|quicken loans|mr cooper|loancare|loan care|newrez|shellpoint|pennymac|freedom mortgage|lakeview loan|phh mortgage|cenlar|dovenmuehle|carrington|guild mortgage|united wholesale|uwm|caliber home|homepoint|roundpoint|hoa|homeowners assoc|condo assoc',
  loan: 'sofi loan|lendingclub|lending club|prosper funding|upstart|marcus loan|discover personal loan|onemain|one main financial|avant|best egg|lightstream|upgrade loan|rocket loans|affirm|klarna|afterpay|sezzle|zip pay|toyota financial|honda financial|ford credit|ford motor credit|gm financial|ally auto|ally financial|chase auto|capital one auto|santander consumer|nissan motor accept|hyundai motor finance|kia finance|subaru motors finance|vw credit|bmw financial|mercedes benz financial|tesla finance|carmax auto finance|carvana|westlake financial|credit acceptance|bridgecrest|exeter finance|world omni',
  paycheck: 'payroll|direct dep|dir dep|direct deposit|adp|paychex|gusto|workday|paylocity|paycom|paycor|trinet|justworks|rippling|bamboohr|zenefits|intuit payroll|quickbooks payroll|square payroll|salary|wages|net pay|ceridian|dayforce|ukg|ultipro|insperity',
  benefits: 'ssa treas|soc sec|social security|ssi treas|ssdi|va benefit|va benef|veterans affairs|dfas|unemployment|odjfs|ui benefit|edd treas|snap benefit|tanf|child support|pension|retirement benefit|opers|strs|calpers|fers|annuity pay|disability pay|workers comp',
  interest_income: 'interest paid|interest payment|interest earned|int earned|interest credit|dividend|div payment|apy earned|savings interest|high yield interest|bonus interest',
  side_income: 'uber driver|uber pro|lyft driver|doordash dasher|dasher pay|instacart shopper|grubhub driver|shipt shopper|amazon flex|etsy deposit|etsy payout|ebay payout|stripe transfer|stripe payout|square inc deposit|square deposit|shopify payout|upwork|fiverr|rover payout|airbnb payout|vrbo payout|turo payout|poshmark payout|mercari payout|substack payout|patreon payout|youtube adsense|google adsense|twitch payout',
  other_income: 'tax refund|irs treas 310 tax ref|state refund|tax ref|rebate|cashback|cash back|cash reward|rewards redemption|statement credit|reimbursement|expense reimb|venmo cashout|venmo cash out|zelle from|paypal transfer|cash app cash out|insurance claim|claim payment|settlement|refund',
}
// ---- merchants that sell across several budget lines: a likely answer, not a confident one ----
const MIXED: Partial<Record<Concept, string>> = {
  groceries: 'walmart|wal mart|wm supercenter|walmart supercenter|walmart neighborhood|costco|costco whse|sams club|samsclub|bjs wholesale|bjs|target grocery|super target|walmart grocery|amazon fresh|amzn fresh|7 eleven|7eleven',
  shopping: 'amazon|amzn|amzn mktp|amazon mktp|amazon marketplace|amazon com|target|walmart com|wal mart com|klarna shop|facebook marketplace',
}
// ---- telling words in a bank description: a likely answer ----
const WORDS: Partial<Record<Concept, string>> = {
  groceries: 'grocery|groceries|grocer|supermarket|market|foods|food mart|meat market|butcher|bakery|produce|deli|co op|coop|international market',
  dining: 'restaurant|rest|grill|grille|kitchen|diner|bistro|cafe|eatery|tavern|pub|bar and grill|bar|brewery|brewing|brewpub|taproom|pizza|pizzeria|burger|burgers|bbq|barbecue|barbeque|steakhouse|steak house|sushi|ramen|pho|thai|taqueria|tacos|taco|burrito|cantina|mexican|chinese|indian|italian|mediterranean|gyro|kebab|wings|chicken|seafood|noodle|noodles|buffet|catering|food truck|sandwich|subs|hoagie|bagel|bagels|wine bar|cocktail|lounge|saloon|trattoria|osteria|creamery',
  coffee: 'coffee|espresso|roasters|roastery|tea house|bubble tea|donut|donuts|doughnut|ice cream|gelato|frozen yogurt|froyo|smoothie|juice bar|cupcake|cookies|candy|chocolat|chocolate|vending',
  fuel: 'fuel|gas station|gasoline|petroleum|oil co|truck stop|travel center|fuel center|filling station|ev charging|charging station',
  transit: 'parking|park garage|garage|meter|toll|tolls|turnpike|transit|metro|subway fare|bus fare|taxi|cab co|shuttle|ferry|rail|railroad|bike share|scooter',
  auto_service: 'auto repair|auto service|automotive|auto parts|auto body|collision|tire|tires|oil change|lube|muffler|transmission|brake|car wash|carwash|detailing|towing|smog|inspection station|motor vehicle|registration renewal|dealership service',
  auto_insurance: 'auto insurance|car insurance|auto ins',
  electric: 'electric|electricity|power company|power and light|light and power|energy bill|electric coop|electric co op|rural electric',
  gas_utility: 'natural gas|gas company|gas co|gas utility|heating oil|fuel oil',
  water: 'water|sewer|waste|garbage|trash|refuse|recycling|stormwater|utilities|utility bill',
  internet: 'internet|broadband|cable|fiber|wifi|satellite tv',
  phone: 'wireless|mobile|cellular|telecom|phone bill',
  subscriptions: 'subscription|membership|monthly plan|annual plan|premium|streaming|app store|software|saas|cloud storage|hosting|domain|newsletter',
  pharmacy: 'pharmacy|pharm|drug|drugs|drugstore|apothecary|rx|prescription',
  medical: 'medical|med ctr|medical center|hospital|clinic|health|healthcare|physician|physicians|doctor|md|dds|dmd|dental|dentist|dentistry|orthodont|optometr|eye care|eyecare|vision center|optical|surgery|surgical|urgent|lab|laboratory|imaging|therapy|therapist|counseling|psychiatr|psycholog|chiro|podiatr|cardiology|oncology|obgyn|womens health|pediatric|family practice|internal medicine|medical group|health system|patient pay|copay',
  health_insurance: 'health insurance|health ins|medical insurance|dental insurance|vision insurance|health premium',
  gym: 'gym|fitness|athletic club|health club|yoga|pilates|crossfit|boxing|martial|climbing|personal training|rec center|recreation center',
  shopping: 'store|shop|shoppe|outlet|mall|boutique|apparel|clothing|clothiers|fashion|shoes|footwear|jewelry|jewelers|electronics|department|dept store|gift shop|variety|thrift|consignment|resale|sporting goods|sports|toys|books|bookstore|stationery|crafts|fabric|cosmetics|beauty supply|vape|tobacco|smoke shop|liquor|wine and spirits|beverage|marketplace',
  home: 'hardware|home improvement|lumber|building supply|furniture|mattress|appliance|flooring|carpet|paint|garden|nursery|landscaping|lawn|pest control|exterminat|plumber|plumbing|electric service|heating|cooling|air conditioning|roofing|window|gutter|cleaning service|maid|housekeeping|locksmith|storage|self storage|moving|u haul|uhaul|home warranty|home security|pool|septic|appliance repair|garage door',
  personal_care: 'salon|barber|hair|nails|nail|spa|massage|wax|waxing|beauty|lashes|brow|tattoo|piercing|tanning|cleaners|dry clean|laundry|laundromat|tailor|alterations|shoe repair',
  entertainment: 'cinema|cinemas|movie|movies|theatre|theater|tickets|ticket|concert|festival|fair|amusement|theme park|water park|zoo|aquarium|museum|gallery|bowling|arcade|golf|mini golf|skating|rink|ski|casino|gaming|games|lottery|karaoke|nightclub|club|comedy|event|stadium|arena|ballpark|sports bar|pool hall|billiards|escape|trampoline|park district|parks and rec',
  travel: 'airlines|airline|airways|air lines|airport|hotel|hotels|motel|inn|resort|lodge|lodging|suites|hostel|bed and breakfast|vacation|cruise|cruises|car rental|rent a car|rental car|travel|tours|tour|excursion|baggage|in flight|inflight|campground|rv park|koa',
  pets: 'pet|pets|vet|veterinary|veterinarian|animal|kennel|groomer|grooming|dog|cat|puppy|aquatics|feed store',
  kids: 'kids|children|childrens|child|baby|toddler|toy|toys|playground|camp|scouts|youth|little league|school pictures|pta|pto|field trip|birthday party',
  education: 'school|schools|academy|university|college|tuition|education|learning|tutoring|tutor|daycare|day care|childcare|child care|preschool|pre school|montessori|kindergarten|student|course|class|classes|lessons|training|seminar|workshop|exam|certification|textbook|library fine',
  gifts: 'donation|donate|charity|charitable|church|ministry|ministries|temple|synagogue|mosque|mission|missions|foundation|fund|relief|nonprofit|non profit|shelter|rescue|food pantry|gift|gifts|florist|flowers|floral|greeting card',
  insurance: 'insurance|ins co|assurance|life ins|premium payment|policy payment|ins prem',
  taxes: 'tax|taxes|taxation|treasurer|revenue|license fee|permit|court|clerk of court|fine|citation|ticket violation|registration fee|notary|filing fee',
  fees: 'fee|fees|service charge|interest|finance charge|penalty',
  rent: 'rent|rental payment|lease|leasing|landlord|property|properties|housing|residences|residential|townhomes|villas|commons|condo|mortgage|home loan|hoa|association dues',
  loan: 'loan|loans|lending|finance co|financial services|auto finance|student loan|installment|payment plan',
  paycheck: 'payroll|salary|wages|paycheck|pay check|direct deposit|net pay|employer|comp pay|earnings',
  benefits: 'benefit|benefits|unemployment|social security|pension|annuity|disability|child support|alimony|stipend|assistance',
  interest_income: 'interest|dividend|dividends|yield',
  side_income: 'payout|payouts|freelance|consulting|contract pay|commission|commissions|gig|tips|royalt|rental income|sales deposit',
  other_income: 'refund|rebate|reimbursement|reimb|cashback|cash back|reward|rewards|credit adjustment|adjustment|reversal|settlement|claim|gift received|deposit',
}
const INCOME: ReadonlySet<Concept> = new Set(['paycheck', 'benefits', 'interest_income', 'side_income', 'other_income'])
export const isIncomeConcept = (c: Concept) => INCOME.has(c)

/** Names in BRANDS that are also everyday words: matched, but never a confident answer on their own. */
const LOOSE = new Set('public utilities|city utilities|municipal util|sanitation|water and sewer|city water|water utility|water dept|water department|water works|waterworks|tst|cta|rta|sce|aps|srp|oge|hca|bart|amc|max|express|gap|coach|vans|regal|lime|calm|wag|dart|sprint|temple|delta|nail|nails|spa|salon|barber|disney|church|parish|foundation|apartment|apartments|apts|realty|vet|zoo|museum|concert|theater|theatre|opera|ballet|casino|bowling|arcade|lottery|trash|refuse|sewer|propane|refund|settlement|rebate|university|college|tuition|southwest|paramount|max com|visible|ting|iga|market|grooming|boarding|kennel|laundry|tailor|waxing|tanning|lash|plumbing|roofing|hvac|electrician|handyman|landscap|donation|charity|charitable|ministry|ministries|mosque|masjid|synagogue|pension|salary|wages|dividend|mortgage|hoa|passport|aquarium|planetarium|botanical|conservatory|arcade|karate|gymnastics|bookstore|textbook|preschool|montessori|daycare|childcare|orthopedic|pediatrics|radiology|dermatology|anesthesia|ambulance|chiropractic'.split('|'))
type Tier = Array<{ concept: Concept; re: RegExp }>
const compile = (t: Partial<Record<Concept, string>>): Tier => (Object.entries(t) as Array<[Concept, string]>).map(([concept, list]) => {
  // longest alternative first, so the regex prefers "uber eats" over "uber" at the same position
  const alts = [...new Set(list.split('|').map(s => s.trim()).filter(Boolean))].sort((a, b) => b.length - a.length)
  return { concept, re: new RegExp(' (' + alts.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?= )', 'g') }
})
const T_BRANDS = compile(BRANDS), T_MIXED = compile(MIXED), T_WORDS = compile(WORDS)
/** The longest name in a tier that appears in the text as whole words; a tie goes to the name that comes first in the text. */
function best(tier: Tier, text: string, income: boolean): { concept: Concept; matched: string } | null {
  let out: { concept: Concept; matched: string; at: number } | null = null
  for (const { concept, re } of tier) {
    if (INCOME.has(concept) !== income) continue
    re.lastIndex = 0; let m: RegExpExecArray | null
    while ((m = re.exec(text))) { const w = m[1]; if (!out || w.length > out.matched.length || (w.length === out.matched.length && m.index < out.at)) out = { concept, matched: w, at: m.index }; re.lastIndex = m.index + 1 }
  }
  return out && { concept: out.concept, matched: out.matched }
}
/** Bank wording for money moved between a person's own accounts — a transfer, an overdraft-protection pull, a round-up sweep — and not the
 *  fee a bank may charge for one. Such a row has no merchant to recognise. */
export const isMoveText = (payee?: string | null) => readsAsTransfer(payee)
/** What the library makes of a payee. `kind` picks the side: money out is matched against spending concepts, money in against income ones. */
export function libraryMatch(payee: string | null | undefined, kind: 'expense' | 'income' = 'expense'): LibraryMatch | null {
  const text = plain(payee); if (text.trim().length < 2) return null
  const income = kind === 'income'
  const b = best(T_BRANDS, text, income), x = best(T_MIXED, text, income), w = best(T_WORDS, text, income)
  // money moved between accounts (0.37.0) has no merchant: "INTERNET TFR TO CHECKING" is not an internet bill and "OVERDRAFT PROTECTION FROM
  // 0253" is not a fee. Only a real merchant named in full survives next to transfer wording ("PAYPAL INST XFER NETFLIX").
  if (isMoveText(payee)) return b && b.matched.length > 2 && !LOOSE.has(b.matched) && b.concept !== 'fees' ? { ...b, confidence: 'high' } : null
  // a named merchant wins over a mixed one unless the mixed name is the longer, more specific match ("walmart" inside "walmart pharmacy" loses)
  if (b && (!x || b.matched.length >= x.matched.length)) {
    // a name that is also an everyday word ("express", "salon", "delta") or is only two letters ("bp", "qt") is only a likely answer —
    // and a longer telling word that says something else is believed over it ("temple pizza kitchen")
    if (b.matched.length <= 2 || LOOSE.has(b.matched)) return w && w.concept !== b.concept && w.matched.length > b.matched.length ? { ...w, confidence: 'medium' } : { ...b, confidence: 'medium' }
    return { ...b, confidence: 'high' }
  }
  if (x) return { concept: x.concept, confidence: 'medium', matched: x.matched }
  if (w) return { concept: w.concept, confidence: 'medium', matched: w.matched }
  return null
}

// ---- concept → the household's own category ----
type Probe = { name: RegExp; group?: RegExp }
const P = (name: RegExp, group?: RegExp): Probe => ({ name, group })
/** For each concept: the category names it looks for, most specific first, then the concepts to fall back on. */
const RESOLVE: Record<Concept, { probes: Probe[]; fallback?: Concept[] }> = {
  groceries: { probes: [P(/grocer|supermarket/), P(/^food$/)] },
  dining: { probes: [P(/dining|restaurant|eating out|take ?out|fast food/), P(/^food( & drink)?$/)] },
  coffee: { probes: [P(/coffee|cafe|snack/)], fallback: ['dining'] },
  fuel: { probes: [P(/fuel|gasoline|gas station|gas ?(&|and|\/) ?(fuel|oil)/), P(/^gas$/, /transport|auto|car|vehicle/)], fallback: ['transit'] },
  transit: { probes: [P(/parking|toll|transit|ride ?shar|taxi|public trans|commut/), P(/^transport(ation)?$/)] },
  auto_service: { probes: [P(/maintenance|repair|service/, /transport|auto|car|vehicle/), P(/(auto|car|vehicle).*(maint|repair|service)/)], fallback: ['transit'] },
  auto_insurance: { probes: [P(/(car|auto|vehicle) insurance/)], fallback: ['insurance'] },
  rent: { probes: [P(/rent|mortgage/), P(/^housing$/)] },
  electric: { probes: [P(/electric|power|energy/), P(/utilit/)] },
  gas_utility: { probes: [P(/natural gas|heating/), P(/^gas$/, /hous|home|util|bill/), P(/utilit/)] },
  water: { probes: [P(/water|sewer|trash|garbage/), P(/utilit/)] },
  internet: { probes: [P(/internet|cable|broadband|wi-?fi/), P(/utilit/)] },
  phone: { probes: [P(/phone|mobile|cell/), P(/utilit/)] },
  subscriptions: { probes: [P(/subscription|streaming|software|membership/)], fallback: ['entertainment'] },
  pharmacy: { probes: [P(/pharmac|prescription|drug/)], fallback: ['medical'] },
  medical: { probes: [P(/medical|dental|doctor|vision|health ?care/), P(/^health$/)] },
  health_insurance: { probes: [P(/health insurance|medical insurance/)], fallback: ['insurance', 'medical'] },
  gym: { probes: [P(/gym|fitness|exercise/)], fallback: ['subscriptions'] },
  shopping: { probes: [P(/shopping|general merchandise|clothing|retail/)], fallback: [] },
  home: { probes: [P(/home (maint|improv|repair|suppl|care)|household|furnish|house ?hold/)], fallback: ['shopping'] },
  personal_care: { probes: [P(/personal care|hair|beauty|salon|grooming/)], fallback: ['shopping'] },
  entertainment: { probes: [P(/entertainment|recreation|hobb|fun/)] },
  travel: { probes: [P(/travel|vacation|trip/)], fallback: ['entertainment'] },
  pets: { probes: [P(/\bpets?\b/)] },
  kids: { probes: [P(/kid|child|family|baby/)] },
  education: { probes: [P(/education|tuition|school|childcare|student/)], fallback: ['kids'] },
  gifts: { probes: [P(/gift|giving|charit|donat|tith/)] },
  insurance: { probes: [P(/insurance \(other\)|^insurance$|life insurance|other insurance/), P(/insurance/)] },
  taxes: { probes: [P(/\btax/)] },
  fees: { probes: [P(/interest (&|and) fees|bank (fee|charge)|^fees?$/), P(/fees?\b/)] },
  loan: { probes: [P(/loan payment|student loan|^loans?$/), P(/\bdebt\b/)] },
  paycheck: { probes: [P(/paycheck|salary|wages|payroll/), P(/^income$/)] },
  benefits: { probes: [P(/benefit|unemployment|social security|pension/)], fallback: ['other_income'] },
  interest_income: { probes: [P(/interest|dividend/)], fallback: ['other_income'] },
  side_income: { probes: [P(/side|freelance|gig|business/)], fallback: ['other_income'] },
  other_income: { probes: [P(/other income|misc/)] },
}
/** The household's category for a concept, or null when it keeps no such line. Archived categories and the wrong side (income vs spending) are never chosen. */
export function resolveCategory(cats: Category[], concept: Concept): Category | null { return resolveWithDepth(cats, concept)?.category ?? null }
/** As resolveCategory, with how many fallbacks it took: 0 = the concept's own line, 1 = the nearest line, 2+ = a distant one. */
export function resolveWithDepth(cats: Category[], concept: Concept, seen: Concept[] = []): { category: Category; depth: number } | null {
  const want = INCOME.has(concept) ? 'income' : 'expense'
  const live = cats.filter(c => !c.archived && c.kind === want).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const r = RESOLVE[concept]
  for (const p of r.probes) { const hit = live.find(c => p.name.test(c.name.toLowerCase()) && (!p.group || p.group.test((c.group || '').toLowerCase()))); if (hit) return { category: hit, depth: 0 } }
  for (const f of r.fallback || []) { if (seen.includes(f)) continue; const hit = resolveWithDepth(cats, f, [...seen, concept]); if (hit) return { category: hit.category, depth: hit.depth + 1 } }
  return null
}
/** The library's answer for a payee as one of the household's categories. A fallback category (coffee → Dining out when there is no
 *  coffee line) is still confident; an answer that had to fall back twice, or a mixed merchant or a telling word, is only likely. */
export function libraryCategory(cats: Category[], payee: string | null | undefined, kind: 'expense' | 'income'): { category: Category; confidence: Confidence; concept: Concept; matched: string } | null {
  const m = libraryMatch(payee, kind); if (!m) return null
  const r = resolveWithDepth(cats, m.concept); if (!r) return null
  return { category: r.category, confidence: r.depth >= 2 ? 'medium' : m.confidence, concept: m.concept, matched: m.matched }
}
/** How many names the library knows — for the About text and the tests. */
export const librarySize = () => [BRANDS, MIXED].reduce((n, t) => n + Object.values(t).reduce((k, s) => k + (s || '').split('|').length, 0), 0)

// ---- who a payee really is, when a payment processor stands in front of the merchant ----
const PROCESSOR = /^\s*(sq|sqc|paypal|pp|sp|tst|dd|py|google|goog|venmo|zelle|cash app|cashapp|apple pay)\s*\*\s*/i
const BARE = new Set('paypal|venmo|zelle|cash app|cashapp|square|sq|apple pay|google pay|venmo payment|zelle payment|paypal transfer|paypal inst xfer'.split('|'))
/** The merchant behind a payee. `key` groups transactions of the same merchant; `pattern` is what a learned rule should match, or null
 *  when the payee names only the processor ("PAYPAL", "VENMO PAYMENT", "SQ *") — a rule for the processor would catch every merchant paid through it.
 *  "PAYPAL *NETFLIX" → netflix; "SQ *BLUE DOOR CAFE" → blue door cafe; "KROGER #1234" → kroger. */
export function merchantIdentity(payee?: string | null): { key: string; pattern: string | null } {
  const raw = String(payee || ''); const m = raw.match(PROCESSOR)
  if (m) { const rest = merchantKey(raw.slice(m[0].length)); const proc = m[1].toLowerCase(); return rest === 'unknown' || rest.length < 3 ? { key: `via ${proc} ${rest === 'unknown' ? '' : rest}`.trim(), pattern: null } : { key: rest, pattern: rest } }
  const k = merchantKey(raw); return { key: k, pattern: k === 'unknown' || BARE.has(k) ? null : k }
}
