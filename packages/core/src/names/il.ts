/**
 * Hand-curated correction targets for Israel: cities, local councils, neighbourhoods, the
 * best-known streets, landmarks, and everyday search words. Facts (names) only, written by
 * us; no third-party data. One line per name: "hebrew|english|kind|weight|city".
 * Weight is a rough importance (population in thousands for places, a guess for the rest).
 */
export const IL_NAMES = `
ירושלים|Jerusalem|city|980
תל אביב-יפו|Tel Aviv-Yafo|city|470
תל אביב|Tel Aviv|city|470
יפו|Jaffa|hood|50|תל אביב-יפו
חיפה|Haifa|city|290
ראשון לציון|Rishon LeZion|city|260
פתח תקווה|Petah Tikva|city|255
אשדוד|Ashdod|city|230
נתניה|Netanya|city|230
באר שבע|Beersheba|city|215
בני ברק|Bnei Brak|city|210
חולון|Holon|city|200
רמת גן|Ramat Gan|city|170
אשקלון|Ashkelon|city|150
רחובות|Rehovot|city|150
בת ים|Bat Yam|city|130
בית שמש|Beit Shemesh|city|150
כפר סבא|Kfar Saba|city|105
הרצליה|Herzliya|city|105
חדרה|Hadera|city|100
מודיעין-מכבים-רעות|Modi'in-Maccabim-Re'ut|city|97
מודיעין|Modiin|city|97
נצרת|Nazareth|city|78
לוד|Lod|city|80
רמלה|Ramla|city|78
רעננה|Ra'anana|city|80
מודיעין עילית|Modi'in Illit|city|80
ביתר עילית|Beitar Illit|city|65
ראש העין|Rosh HaAyin|city|70
הוד השרון|Hod HaSharon|city|65
קריית גת|Kiryat Gat|city|60
נהריה|Nahariya|city|60
גבעתיים|Givatayim|city|60
קריית אתא|Kiryat Ata|city|60
עפולה|Afula|city|60
אום אל-פחם|Umm al-Fahm|city|57
יבנה|Yavne|city|55
אילת|Eilat|city|53
עכו|Acre|city|50
אלעד|Elad|city|50
רמת השרון|Ramat HaSharon|city|48
כרמיאל|Karmiel|city|47
טבריה|Tiberias|city|46
נתיבות|Netivot|city|47
קריית מוצקין|Kiryat Motzkin|city|42
טייבה|Tayibe|city|45
שפרעם|Shefa-'Amr|city|43
נס ציונה|Ness Ziona|city|50
קריית ביאליק|Kiryat Bialik|city|42
קריית ים|Kiryat Yam|city|40
קריית אונו|Kiryat Ono|city|40
מעלה אדומים|Ma'ale Adumim|city|38
אור יהודה|Or Yehuda|city|37
צפת|Safed|city|37
דימונה|Dimona|city|35
טמרה|Tamra|city|35
אופקים|Ofakim|city|35
סח'נין|Sakhnin|city|33
יהוד-מונוסון|Yehud-Monosson|city|31
יהוד|Yehud|city|31
באקה אל-גרבייה|Baqa al-Gharbiyye|city|30
שדרות|Sderot|city|35
באר יעקב|Be'er Ya'akov|city|30
כפר יונה|Kfar Yona|city|30
גבעת שמואל|Giv'at Shmuel|city|28
טירה|Tira|city|27
ערד|Arad|city|28
קריית שמונה|Kiryat Shmona|city|23
מגדל העמק|Migdal HaEmek|city|27
עראבה|Arraba|city|26
טירת כרמל|Tirat Carmel|city|24
רהט|Rahat|city|80
נוף הגליל|Nof HaGalil|city|45
יקנעם עילית|Yokneam Illit|city|25
קלנסווה|Qalansawe|city|24
אריאל|Ariel|city|20
קריית מלאכי|Kiryat Malakhi|city|25
בית שאן|Beit She'an|city|18
אור עקיבא|Or Akiva|city|20
מעלות-תרשיחא|Ma'alot-Tarshiha|city|21
נשר|Nesher|city|24
כפר קאסם|Kafr Qasim|city|25
קריית עקרון|Kiryat Ekron|town|12
גדרה|Gedera|town|30
גן יבנה|Gan Yavne|town|25
מזכרת בתיה|Mazkeret Batya|town|17
זכרון יעקב|Zikhron Ya'akov|town|25
פרדס חנה-כרכור|Pardes Hanna-Karkur|town|45
פרדס חנה|Pardes Hanna|town|45
בנימינה-גבעת עדה|Binyamina-Giv'at Ada|town|17
קיסריה|Caesarea|town|6
אבן יהודה|Even Yehuda|town|15
כוכב יאיר|Kokhav Yair|town|10
צור יגאל|Tzur Yigal|town|10
שוהם|Shoham|town|24
גני תקווה|Ganei Tikva|town|20
סביון|Savyon|town|4
קדימה-צורן|Kadima-Zoran|town|23
תל מונד|Tel Mond|town|14
כפר שמריהו|Kfar Shmaryahu|town|2
מבשרת ציון|Mevaseret Zion|town|25
אפרת|Efrat|town|12
קרני שומרון|Karnei Shomron|town|9
אורנית|Oranit|town|9
אלפי מנשה|Alfei Menashe|town|8
גבעת זאב|Giv'at Ze'ev|town|20
עמנואל|Immanuel|town|5
קצרין|Katzrin|town|8
ראש פינה|Rosh Pinna|town|3
מטולה|Metula|town|2
חצור הגלילית|Hatzor HaGlilit|town|10
קריית טבעון|Kiryat Tiv'on|town|19
רמת ישי|Ramat Yishai|town|8
עתלית|Atlit|town|6
מצפה רמון|Mitzpe Ramon|town|5
ירוחם|Yeruham|town|11
עומר|Omer|town|8
להבים|Lehavim|town|7
מיתר|Meitar|town|9
כפר ורדים|Kfar Vradim|town|6
שלומי|Shlomi|town|7
מגדל|Migdal|town|2
יסוד המעלה|Yesud HaMa'ala|town|2
קריית ארבע|Kiryat Arba|town|7
בית אל|Beit El|town|6
אלון שבות|Alon Shvut|town|3
גבעת עדה|Giv'at Ada|town|5
בני עי"ש|Bnei Ayish|town|9
קריית יערים|Kiryat Ye'arim|town|5
אבו גוש|Abu Ghosh|town|8
מגאר|Maghar|town|23
דלית אל-כרמל|Daliyat al-Karmel|town|17
עספיא|Isfiya|town|12
ג'סר א-זרקא|Jisr az-Zarqa|town|15
פוריידיס|Fureidis|town|13
כפר כנא|Kafr Kanna|town|23
ריינה|Reineh|town|20
יפיע|Yafa an-Naseriyye|town|20
מג'דל שמס|Majdal Shams|town|11
כסיפה|Kuseife|town|22
ערערה בנגב|Ar'arat an-Naqab|town|19
תל שבע|Tel Sheva|town|20
לקיה|Lakiya|town|15
חורה|Hura|town|22
שגב שלום|Segev Shalom|town|12
עין גדי|Ein Gedi|town|1
נווה אילן|Neve Ilan|town|1
עין כרם|Ein Karem|hood|2|ירושלים
גבעת רם|Givat Ram|hood|2|ירושלים
רחביה|Rehavia|hood|10|ירושלים
טלביה|Talbiye|hood|5|ירושלים
המושבה הגרמנית|German Colony|hood|8|ירושלים
בקעה|Baka|hood|10|ירושלים
קטמון|Katamon|hood|15|ירושלים
גילה|Gilo|hood|30|ירושלים
פסגת זאב|Pisgat Ze'ev|hood|45|ירושלים
רמות|Ramot|hood|50|ירושלים
הר חומה|Har Homa|hood|25|ירושלים
תלפיות|Talpiot|hood|20|ירושלים
בית הכרם|Beit HaKerem|hood|15|ירושלים
קריית יובל|Kiryat Yovel|hood|25|ירושלים
מאה שערים|Mea She'arim|hood|10|ירושלים
נחלאות|Nachlaot|hood|8|ירושלים
העיר העתיקה|Old City|hood|40|ירושלים
ממילא|Mamilla|hood|5|ירושלים
הר הצופים|Mount Scopus|hood|5|ירושלים
הר הבית|Temple Mount|poi|40|ירושלים
הכותל המערבי|Western Wall|poi|60|ירושלים
הכותל|Kotel|poi|60|ירושלים
יד ושם|Yad Vashem|poi|30|ירושלים
הכנסת|Knesset|poi|30|ירושלים
מוזיאון ישראל|Israel Museum|poi|25|ירושלים
שוק מחנה יהודה|Mahane Yehuda Market|poi|30|ירושלים
מחנה יהודה|Mahane Yehuda|poi|30|ירושלים
התחנה הראשונה|First Station|poi|15|ירושלים
גן החיות התנ"כי|Biblical Zoo|poi|15|ירושלים
הר הרצל|Mount Herzl|poi|15|ירושלים
הר הזיתים|Mount of Olives|poi|15|ירושלים
כנסיית הקבר|Church of the Holy Sepulchre|poi|20|ירושלים
מגדל דוד|Tower of David|poi|15|ירושלים
שער יפו|Jaffa Gate|poi|15|ירושלים
שער שכם|Damascus Gate|poi|10|ירושלים
טדי|Teddy Stadium|poi|10|ירושלים
ארנה ירושלים|Jerusalem Arena|poi|8|ירושלים
קניון מלחה|Malha Mall|poi|15|ירושלים
קניון ממילא|Mamilla Mall|poi|10|ירושלים
הדסה עין כרם|Hadassah Ein Kerem|poi|25|ירושלים
הדסה הר הצופים|Hadassah Mount Scopus|poi|15|ירושלים
שערי צדק|Shaare Zedek|poi|20|ירושלים
האוניברסיטה העברית|Hebrew University|poi|25|ירושלים
התחנה המרכזית ירושלים|Jerusalem Central Bus Station|poi|20|ירושלים
גשר המיתרים|Chords Bridge|poi|10|ירושלים
יפו|Jaffa Road|street|30|ירושלים
בן יהודה|Ben Yehuda|street|30|ירושלים
קינג ג'ורג'|King George|street|25|ירושלים
המלך ג'ורג'|King George|street|25|ירושלים
עמק רפאים|Emek Refaim|street|20|ירושלים
אגריפס|Agripas|street|15|ירושלים
הנביאים|HaNevi'im|street|15|ירושלים
שדרות הרצל|Herzl Boulevard|street|20|ירושלים
דרך חברון|Hebron Road|street|20|ירושלים
המלך דוד|King David|street|20|ירושלים
עזה|Aza|street|10|ירושלים
קרן היסוד|Keren HaYesod|street|10|ירושלים
בגין|Begin|street|20
דיזנגוף|Dizengoff|street|60|תל אביב-יפו
דיזנגוף סנטר|Dizengoff Center|poi|40|תל אביב-יפו
כיכר דיזנגוף|Dizengoff Square|poi|30|תל אביב-יפו
אבן גבירול|Ibn Gabirol|street|50|תל אביב-יפו
שדרות רוטשילד|Rothschild Boulevard|street|50|תל אביב-יפו
רוטשילד|Rothschild|street|50
אלנבי|Allenby|street|45|תל אביב-יפו
הירקון|HaYarkon|street|35|תל אביב-יפו
בן יהודה|Ben Yehuda|street|40|תל אביב-יפו
שינקין|Sheinkin|street|30|תל אביב-יפו
נחלת בנימין|Nahalat Binyamin|street|30|תל אביב-יפו
קינג ג'ורג'|King George|street|30|תל אביב-יפו
המלך ג'ורג'|King George|street|30|תל אביב-יפו
ארלוזורוב|Arlozorov|street|35|תל אביב-יפו
ז'בוטינסקי|Jabotinsky|street|35
ויצמן|Weizmann|street|30
הרצל|Herzl|street|40
בוגרשוב|Bograshov|street|20|תל אביב-יפו
פרישמן|Frishman|street|20|תל אביב-יפו
גורדון|Gordon|street|20|תל אביב-יפו
שאול המלך|Shaul HaMelech|street|25|תל אביב-יפו
דרך מנחם בגין|Menachem Begin Road|street|35|תל אביב-יפו
דרך נמיר|Namir Road|street|30|תל אביב-יפו
לבונטין|Levontin|street|15|תל אביב-יפו
לוינסקי|Levinsky|street|20|תל אביב-יפו
יהודה הלוי|Yehuda HaLevi|street|20|תל אביב-יפו
הארבעה|HaArba'a|street|15|תל אביב-יפו
קפלן|Kaplan|street|25|תל אביב-יפו
אחד העם|Ahad Ha'am|street|25
שדרות ירושלים|Jerusalem Boulevard|street|20|תל אביב-יפו
שדרות ח"ן|Chen Boulevard|street|15|תל אביב-יפו
שדרות בן גוריון|Ben Gurion Boulevard|street|25
בן גוריון|Ben Gurion|street|30
פינסקר|Pinsker|street|15
בלפור|Balfour|street|15
הכרמל|HaCarmel|street|20
שוק הכרמל|Carmel Market|poi|35|תל אביב-יפו
שוק לוינסקי|Levinsky Market|poi|15|תל אביב-יפו
שוק הפשפשים|Jaffa Flea Market|poi|20|תל אביב-יפו
נמל תל אביב|Tel Aviv Port|poi|30|תל אביב-יפו
נמל יפו|Jaffa Port|poi|20|תל אביב-יפו
שרונה|Sarona|poi|25|תל אביב-יפו
שרונה מרקט|Sarona Market|poi|20|תל אביב-יפו
עזריאלי|Azrieli|poi|50|תל אביב-יפו
קניון עזריאלי|Azrieli Mall|poi|50|תל אביב-יפו
מרכז עזריאלי|Azrieli Center|poi|50|תל אביב-יפו
עזריאלי שרונה|Azrieli Sarona|poi|20|תל אביב-יפו
גני שרונה|Sarona Gardens|poi|15|תל אביב-יפו
קניון רמת אביב|Ramat Aviv Mall|poi|25|תל אביב-יפו
גן העיר|Gan Ha'ir|poi|10|תל אביב-יפו
מגדל שלום|Shalom Tower|poi|15|תל אביב-יפו
התחנה המרכזית החדשה|New Central Bus Station|poi|25|תל אביב-יפו
תחנת רכבת השלום|HaShalom Railway Station|poi|25|תל אביב-יפו
תחנת רכבת סבידור מרכז|Savidor Center Railway Station|poi|25|תל אביב-יפו
סבידור|Savidor|poi|20|תל אביב-יפו
ההגנה|HaHagana|poi|15|תל אביב-יפו
פארק הירקון|Yarkon Park|poi|35|תל אביב-יפו
גני יהושע|Ganei Yehoshua|poi|20|תל אביב-יפו
כיכר רבין|Rabin Square|poi|30|תל אביב-יפו
כיכר הבימה|Habima Square|poi|25|תל אביב-יפו
הבימה|Habima|poi|25|תל אביב-יפו
מוזיאון תל אביב לאמנות|Tel Aviv Museum of Art|poi|20|תל אביב-יפו
מוזיאון ארץ ישראל|Eretz Israel Museum|poi|15|תל אביב-יפו
אנו - מוזיאון העם היהודי|ANU Museum of the Jewish People|poi|15|תל אביב-יפו
היכל מנורה מבטחים|Menora Mivtachim Arena|poi|20|תל אביב-יפו
בלומפילד|Bloomfield Stadium|poi|20|תל אביב-יפו
איכילוב|Ichilov|poi|35|תל אביב-יפו
המרכז הרפואי תל אביב|Tel Aviv Sourasky Medical Center|poi|30|תל אביב-יפו
אוניברסיטת תל אביב|Tel Aviv University|poi|35|תל אביב-יפו
פלורנטין|Florentin|hood|25|תל אביב-יפו
נווה צדק|Neve Tzedek|hood|25|תל אביב-יפו
רמת אביב|Ramat Aviv|hood|30|תל אביב-יפו
הצפון הישן|Old North|hood|25|תל אביב-יפו
הצפון החדש|New North|hood|20|תל אביב-יפו
לב העיר|Lev HaIr|hood|15|תל אביב-יפו
כרם התימנים|Kerem HaTeimanim|hood|15|תל אביב-יפו
עג'מי|Ajami|hood|15|תל אביב-יפו
יד אליהו|Yad Eliyahu|hood|15|תל אביב-יפו
בבלי|Bavli|hood|10|תל אביב-יפו
נווה אביבים|Neve Avivim|hood|10|תל אביב-יפו
רמת החייל|Ramat HaHayal|hood|15|תל אביב-יפו
הדר יוסף|Hadar Yosef|hood|8|תל אביב-יפו
שכונת התקווה|Hatikva Quarter|hood|15|תל אביב-יפו
מונטיפיורי|Montefiore|hood|8|תל אביב-יפו
חוף גורדון|Gordon Beach|poi|20|תל אביב-יפו
חוף פרישמן|Frishman Beach|poi|15|תל אביב-יפו
חוף בוגרשוב|Bograshov Beach|poi|15|תל אביב-יפו
חוף הילטון|Hilton Beach|poi|15|תל אביב-יפו
חוף מציצים|Metzitzim Beach|poi|15|תל אביב-יפו
חוף אביבים|Aviv Beach|poi|5
חוף דור|Dor Beach|poi|10
חוף פלמחים|Palmachim Beach|poi|10
חוף בית ינאי|Beit Yanai Beach|poi|10
חוף אכזיב|Achziv Beach|poi|10
חוף הצוק|HaTsuk Beach|poi|10
טיילת|Promenade|word|20
הטיילת|The Promenade|poi|20
מושבה הגרמנית|German Colony|hood|8|חיפה
הדר הכרמל|Hadar HaCarmel|hood|25|חיפה
הדר|Hadar|hood|25|חיפה
מרכז הכרמל|Merkaz HaCarmel|hood|20|חיפה
נווה שאנן|Neve Sha'anan|hood|20|חיפה
ואדי ניסנאס|Wadi Nisnas|hood|10|חיפה
בת גלים|Bat Galim|hood|10|חיפה
קריית חיים|Kiryat Haim|hood|20|חיפה
דניה|Denya|hood|10|חיפה
רמות רמז|Ramot Remez|hood|5|חיפה
הגנים הבהאיים|Bahá'í Gardens|poi|35|חיפה
הגנים הבהאים|Bahai Gardens|poi|35|חיפה
שדרות בן גוריון|Ben Gurion Avenue|street|20|חיפה
שדרות הנשיא|HaNassi Boulevard|street|20|חיפה
דרך העצמאות|HaAtzmaut Road|street|15|חיפה
מוריה|Moriah|street|20|חיפה
חורב|Horev|street|15|חיפה
הנמל|HaNamal|street|10|חיפה
קניון חוצות המפרץ|Hutzot HaMifratz|poi|15|חיפה
גרנד קניון|Grand Canyon Mall|poi|20|חיפה
קניון חיפה|Haifa Mall|poi|10|חיפה
הטכניון|Technion|poi|30|חיפה
טכניון|Technion|poi|30|חיפה
אוניברסיטת חיפה|University of Haifa|poi|25|חיפה
רמב"ם|Rambam Health Care Campus|poi|30|חיפה
בית חולים רמב"ם|Rambam Hospital|poi|30|חיפה
כרמל|Carmel|poi|20|חיפה
הכרמלית|Carmelit|poi|15|חיפה
סמי עופר|Sammy Ofer Stadium|poi|15|חיפה
מערת אליהו|Elijah's Cave|poi|8|חיפה
סטלה מאריס|Stella Maris|poi|10|חיפה
המושבה הגרמנית חיפה|Haifa German Colony|poi|15|חיפה
רגר|Rager|street|20|באר שבע
שדרות רגר|Rager Boulevard|street|20|באר שבע
העיר העתיקה באר שבע|Beersheba Old City|hood|10|באר שבע
קניון הנגב|Negev Mall|poi|15|באר שבע
גרנד קניון באר שבע|Grand Canyon Beersheba|poi|15|באר שבע
סורוקה|Soroka|poi|30|באר שבע
אוניברסיטת בן גוריון|Ben-Gurion University|poi|25|באר שבע
טרנר|Turner Stadium|poi|10|באר שבע
נחל באר שבע|Beersheba River Park|poi|10|באר שבע
שכונה ד|Neighborhood D|hood|8|באר שבע
רמות|Ramot|hood|20|באר שבע
נווה זאב|Neve Ze'ev|hood|15|באר שבע
שיבא|Sheba Medical Center|poi|35|רמת גן
תל השומר|Tel HaShomer|poi|35|רמת גן
בילינסון|Beilinson|poi|30|פתח תקווה
שניידר|Schneider Children's Medical Center|poi|25|פתח תקווה
וולפסון|Wolfson|poi|20|חולון
אסף הרופא|Assaf Harofeh|poi|20|באר יעקב
שמיר|Shamir Medical Center|poi|20|באר יעקב
מאיר|Meir Medical Center|poi|20|כפר סבא
לניאדו|Laniado|poi|15|נתניה
הלל יפה|Hillel Yaffe|poi|15|חדרה
ברזילי|Barzilai|poi|15|אשקלון
אסותא|Assuta|poi|20
קפלן|Kaplan Medical Center|poi|20|רחובות
העמק|HaEmek Medical Center|poi|15|עפולה
פוריה|Poriya|poi|10|טבריה
זיו|Ziv Medical Center|poi|10|צפת
הלל יפה|Hillel Yaffe Medical Center|poi|15|חדרה
יוספטל|Yoseftal|poi|10|אילת
בית חולים|Hospital|word|30
אוניברסיטת בר אילן|Bar-Ilan University|poi|25|רמת גן
בר אילן|Bar-Ilan|poi|25|רמת גן
מכון ויצמן|Weizmann Institute|poi|20|רחובות
אוניברסיטת אריאל|Ariel University|poi|15|אריאל
רייכמן|Reichman University|poi|15|הרצליה
המרכז הבינתחומי|IDC Herzliya|poi|10|הרצליה
האוניברסיטה הפתוחה|Open University|poi|10|רעננה
מכללת ספיר|Sapir College|poi|8|שדרות
קניון איילון|Ayalon Mall|poi|25|רמת גן
קניון הזהב|Hazahav Mall|poi|15|ראשון לציון
קניון ביג|BIG|poi|10
קניון סירקין|Sirkin|poi|5|פתח תקווה
קניון עזריאלי מודיעין|Azrieli Modiin|poi|10|מודיעין
קניון עזריאלי חיפה|Azrieli Haifa|poi|10|חיפה
קניון עזריאלי ירושלים|Azrieli Jerusalem|poi|10|ירושלים
קניון עופר|Ofer Mall|poi|10
קניון שבעת הכוכבים|Seven Stars Mall|poi|15|הרצליה
קניון הרצליה|Herzliya Mall|poi|10|הרצליה
קניון רננים|Renanim Mall|poi|10|רעננה
קניון ערים|Arim Mall|poi|10|כפר סבא
קניון G|G Mall|poi|10|כפר סבא
קניון אופק|Ofek Mall|poi|5|פתח תקווה
קניון גבעתיים|Givatayim Mall|poi|10|גבעתיים
קניון חולון|Holon Mall|poi|10|חולון
קניון בת ים|Bat Yam Mall|poi|10|בת ים
קניון לב אשדוד|Lev Ashdod|poi|10|אשדוד
סטאר סנטר|Star Center|poi|10|אשדוד
קניון פולג|Poleg Mall|poi|10|נתניה
עיר ימים|Ir Yamim Mall|poi|10|נתניה
קניון הנמל|HaNamal Mall|poi|5
מגדלי עזריאלי|Azrieli Towers|poi|30|תל אביב-יפו
שוק התקווה|HaTikva Market|poi|10|תל אביב-יפו
בורסה|Diamond Exchange|poi|15|רמת גן
הבורסה|The Bursa|poi|15|רמת גן
ספארי|Safari|poi|25|רמת גן
הספארי|Ramat Gan Safari|poi|25|רמת גן
פארק הלאומי רמת גן|Ramat Gan National Park|poi|15|רמת גן
לונה פארק|Luna Park|poi|15|תל אביב-יפו
מרינה הרצליה|Herzliya Marina|poi|15|הרצליה
נמל התעופה בן גוריון|Ben Gurion Airport|poi|80
נתב"ג|Natbag|poi|80
שדה התעופה רמון|Ramon Airport|poi|20|אילת
שדה דב|Sde Dov|poi|5|תל אביב-יפו
מצדה|Masada|poi|40
ים המלח|Dead Sea|poi|50
ים כנרת|Sea of Galilee|poi|40
כנרת|Kinneret|poi|40
החרמון|Mount Hermon|poi|25
הר החרמון|Mount Hermon|poi|25
הר תבור|Mount Tabor|poi|15
הר מירון|Mount Meron|poi|15
הר הכרמל|Mount Carmel|poi|20
מכתש רמון|Makhtesh Ramon|poi|25
עין גדי|Ein Gedi Reserve|poi|25
עין בוקק|Ein Bokek|poi|20
קיסריה העתיקה|Caesarea National Park|poi|20
גן לאומי קיסריה|Caesarea National Park|poi|20
גן לאומי אשקלון|Ashkelon National Park|poi|15
בית גוברין|Beit Guvrin|poi|15
גן השלושה|Gan HaShlosha|poi|20
הסחנה|Sakhne|poi|20
בניאס|Banias|poi|20
תל דן|Tel Dan|poi|15
נחל עמוד|Nahal Amud|poi|10
נחל דוד|Nahal David|poi|10
עין חמד|Ein Hemed|poi|10
גן לאומי הירקון|Yarkon National Park|poi|15
מקורות הירקון|Yarkon Springs|poi|10
עין עבדת|Ein Avdat|poi|15
עבדת|Avdat|poi|10
תמנע|Timna Park|poi|15
פארק תמנע|Timna Park|poi|15
ראש הנקרה|Rosh HaNikra|poi|20
יער בן שמן|Ben Shemen Forest|poi|10
פארק קנדה|Canada Park|poi|10
הר הבנטל|Mount Bental|poi|10
אכזיב|Achziv|poi|10
חמת גדר|Hamat Gader|poi|15
מערת הנטיפים|Soreq Cave|poi|10
עכו העתיקה|Old Acre|poi|20|עכו
שוק הפשפשים יפו|Jaffa Flea Market|poi|15|תל אביב-יפו
הנמל של יפו|Jaffa Port|poi|15|תל אביב-יפו
שדרות ירושלים יפו|Jerusalem Boulevard Jaffa|street|10|תל אביב-יפו
כביש 1|Highway 1|street|30
כביש 2|Highway 2|street|25
כביש 4|Highway 4|street|25
כביש 6|Highway 6|street|30
כביש 20|Highway 20|street|25
איילון|Ayalon Highway|street|30
נתיבי איילון|Ayalon Highway|street|30
כביש החוף|Coastal Highway|street|20
כביש 90|Highway 90|street|20
מחלף גלילות|Glilot Interchange|poi|15
צומת גלילות|Glilot Junction|poi|15
מחלף לה גרדיה|La Guardia Interchange|poi|10
צומת בית ליד|Beit Lid Junction|poi|10
צומת גומא|Goma Junction|poi|5
צומת גולני|Golani Junction|poi|10
רכבת ישראל|Israel Railways|poi|30
תחנה מרכזית|Central Bus Station|word|30
תחנת רכבת|Train Station|word|30
הרכבת הקלה|Light Rail|poi|20
רכבת קלה|Light Rail|word|20
הקו האדום|Red Line|poi|15
הקו הירוק|Green Line|poi|10
קפה|cafe|word|60
בית קפה|coffee shop|word|50
בתי קפה|cafes|word|40
מסעדה|restaurant|word|60
מסעדות|restaurants|word|50
פיצה|pizza|word|50
פיצריה|pizzeria|word|40
המבורגר|hamburger|word|30
סושי|sushi|word|30
שווארמה|shawarma|word|30
פלאפל|falafel|word|30
חומוס|hummus|word|30
גלידה|ice cream|word|25
מאפייה|bakery|word|25
בר|bar|word|30
פאב|pub|word|25
סופרמרקט|supermarket|word|50
סופר|super|word|40
מכולת|grocery|word|20
בית מרקחת|pharmacy|word|40
סופר פארם|Super-Pharm|poi|40
סופר-פארם|Super-Pharm|poi|40
שופרסל|Shufersal|poi|40
רמי לוי|Rami Levy|poi|40
יוחננוף|Yochananof|poi|25
ויקטורי|Victory|poi|25
טיב טעם|Tiv Taam|poi|20
אושר עד|Osher Ad|poi|20
יינות ביתן|Yeinot Bitan|poi|20
מגה|Mega|poi|15
קרפור|Carrefour|poi|20
איקאה|IKEA|poi|25
אייס|ACE|poi|15
הום סנטר|Home Center|poi|15
ארומה|Aroma|poi|30
קפה קפה|Cafe Cafe|poi|20
לנדוור|Landwer|poi|20
קפה גרג|Cafe Greg|poi|20
גרג|Greg|poi|20
מקדונלדס|McDonald's|poi|30
בורגר קינג|Burger King|poi|20
דומינוס|Domino's|poi|20
פיצה האט|Pizza Hut|poi|15
ארקפה|Arcaffe|poi|15
רולדין|Roladin|poi|15
מקס ברנר|Max Brenner|poi|10
בנק|bank|word|40
בנק הפועלים|Bank Hapoalim|poi|30
בנק לאומי|Bank Leumi|poi|30
בנק דיסקונט|Discount Bank|poi|25
בנק מזרחי טפחות|Mizrahi Tefahot|poi|25
דואר ישראל|Israel Post|poi|30
סניף דואר|post office|word|30
דואר|post|word|30
כספומט|ATM|word|40
תחנת דלק|gas station|word|40
דלק|fuel|word|30
פז|Paz|poi|25
סונול|Sonol|poi|20
דור אלון|Dor Alon|poi|20
חניון|parking|word|40
חניה|parking|word|40
מלון|hotel|word|40
מלונות|hotels|word|30
צימר|zimmer|word|25
אכסניה|hostel|word|15
חוף|beach|word|40
חוף ים|beach|word|35
פארק|park|word|40
גן שעשועים|playground|word|20
גן משחקים|playground|word|20
מוזיאון|museum|word|30
קולנוע|cinema|word|25
סינמה סיטי|Cinema City|poi|20
יס פלנט|Yes Planet|poi|20
תיאטרון|theatre|word|20
ספרייה|library|word|20
בית ספר|school|word|30
גן ילדים|kindergarten|word|20
אוניברסיטה|university|word|30
מכללה|college|word|20
בית כנסת|synagogue|word|30
מסגד|mosque|word|20
כנסייה|church|word|20
מרפאה|clinic|word|30
כללית|Clalit|poi|30
מכבי|Maccabi|poi|30
מאוחדת|Meuhedet|poi|20
לאומית|Leumit|poi|20
מד"א|Magen David Adom|poi|20
מגן דוד אדום|Magen David Adom|poi|20
משטרה|police|word|30
תחנת משטרה|police station|word|25
עירייה|city hall|word|30
עיריית תל אביב|Tel Aviv City Hall|poi|15|תל אביב-יפו
בית משפט|court|word|20
משרד הפנים|Ministry of Interior|poi|20
ביטוח לאומי|National Insurance|poi|25
מס הכנסה|Income Tax|poi|15
רשות האוכלוסין|Population Authority|poi|15
קופת חולים|health fund|word|25
מספרה|barber|word|20
מכון כושר|gym|word|25
חדר כושר|gym|word|20
בריכה|swimming pool|word|20
קניון|mall|word|40
שוק|market|word|30
חנות|shop|word|30
חנות בגדים|clothes shop|word|15
חומרי בניין|hardware store|word|10
מוסך|garage|word|20
שטיפת רכב|car wash|word|10
טעינה|charging|word|20
עמדת טעינה|charging station|word|20
וטרינר|vet|word|15
חנות חיות|pet shop|word|10
פרחים|flowers|word|10
ממתקים|sweets|word|10
יין|wine|word|10
אוכל|food|word|30
ארוחת בוקר|breakfast|word|20
אוכל אסייתי|asian food|word|10
אוכל איטלקי|italian food|word|10
בשרים|grill|word|15
דגים|fish|word|10
טבעוני|vegan|word|15
צמחוני|vegetarian|word|10
כשר|kosher|word|20
פתוח עכשיו|open now|word|20
ליד|near|word|10
קרוב|nearby|word|10
באזור|in the area|word|10
רחוב|street|word|40
שדרות|boulevard|word|30
דרך|road|word|30
כיכר|square|word|30
סמטת|alley|word|10
שכונת|neighborhood|word|20
שכונה|neighborhood|word|20
מושב|moshav|word|20
קיבוץ|kibbutz|word|20
צומת|junction|word|30
מחלף|interchange|word|20
גשר|bridge|word|10
נמל|port|word|15
מרכז|center|word|30
מגדל|tower|word|20
שער|gate|word|10
הר|mountain|word|20
נחל|stream|word|20
מעיין|spring|word|15
יער|forest|word|15
שמורת טבע|nature reserve|word|15
גן לאומי|national park|word|20
אגם|lake|word|10
מערה|cave|word|10
תצפית|viewpoint|word|15
`;
