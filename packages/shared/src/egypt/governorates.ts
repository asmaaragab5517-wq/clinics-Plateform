export interface Governorate {
  code: string; // National ID governorate code
  slug: string;
  ar: string;
  en: string;
  cities: { ar: string; en: string }[];
}

/** The 27 governorates of Egypt with National ID codes and principal cities (LOC-7). */
export const GOVERNORATES: Governorate[] = [
  { code: '01', slug: 'cairo', ar: 'القاهرة', en: 'Cairo', cities: [{ ar: 'مدينة نصر', en: 'Nasr City' }, { ar: 'مصر الجديدة', en: 'Heliopolis' }, { ar: 'المعادي', en: 'Maadi' }, { ar: 'القاهرة الجديدة', en: 'New Cairo' }, { ar: 'وسط البلد', en: 'Downtown' }, { ar: 'شبرا', en: 'Shubra' }] },
  { code: '02', slug: 'alexandria', ar: 'الإسكندرية', en: 'Alexandria', cities: [{ ar: 'سموحة', en: 'Smouha' }, { ar: 'سيدي جابر', en: 'Sidi Gaber' }, { ar: 'المنتزه', en: 'Montaza' }, { ar: 'العجمي', en: 'Agami' }] },
  { code: '03', slug: 'port-said', ar: 'بورسعيد', en: 'Port Said', cities: [{ ar: 'بورسعيد', en: 'Port Said' }, { ar: 'بورفؤاد', en: 'Port Fouad' }] },
  { code: '04', slug: 'suez', ar: 'السويس', en: 'Suez', cities: [{ ar: 'السويس', en: 'Suez' }] },
  { code: '11', slug: 'damietta', ar: 'دمياط', en: 'Damietta', cities: [{ ar: 'دمياط', en: 'Damietta' }, { ar: 'دمياط الجديدة', en: 'New Damietta' }] },
  { code: '12', slug: 'dakahlia', ar: 'الدقهلية', en: 'Dakahlia', cities: [{ ar: 'المنصورة', en: 'Mansoura' }, { ar: 'طلخا', en: 'Talkha' }, { ar: 'ميت غمر', en: 'Mit Ghamr' }] },
  { code: '13', slug: 'sharqia', ar: 'الشرقية', en: 'Sharqia', cities: [{ ar: 'الزقازيق', en: 'Zagazig' }, { ar: 'العاشر من رمضان', en: '10th of Ramadan' }] },
  { code: '14', slug: 'qalyubia', ar: 'القليوبية', en: 'Qalyubia', cities: [{ ar: 'بنها', en: 'Banha' }, { ar: 'شبرا الخيمة', en: 'Shubra El Kheima' }] },
  { code: '15', slug: 'kafr-el-sheikh', ar: 'كفر الشيخ', en: 'Kafr El Sheikh', cities: [{ ar: 'كفر الشيخ', en: 'Kafr El Sheikh' }] },
  { code: '16', slug: 'gharbia', ar: 'الغربية', en: 'Gharbia', cities: [{ ar: 'طنطا', en: 'Tanta' }, { ar: 'المحلة الكبرى', en: 'El Mahalla El Kubra' }] },
  { code: '17', slug: 'monufia', ar: 'المنوفية', en: 'Monufia', cities: [{ ar: 'شبين الكوم', en: 'Shebin El Kom' }, { ar: 'مدينة السادات', en: 'Sadat City' }] },
  { code: '18', slug: 'beheira', ar: 'البحيرة', en: 'Beheira', cities: [{ ar: 'دمنهور', en: 'Damanhour' }, { ar: 'كفر الدوار', en: 'Kafr El Dawar' }] },
  { code: '19', slug: 'ismailia', ar: 'الإسماعيلية', en: 'Ismailia', cities: [{ ar: 'الإسماعيلية', en: 'Ismailia' }] },
  { code: '21', slug: 'giza', ar: 'الجيزة', en: 'Giza', cities: [{ ar: 'الدقي', en: 'Dokki' }, { ar: 'المهندسين', en: 'Mohandessin' }, { ar: 'الشيخ زايد', en: 'Sheikh Zayed' }, { ar: '٦ أكتوبر', en: '6th of October' }, { ar: 'الهرم', en: 'Haram' }] },
  { code: '22', slug: 'beni-suef', ar: 'بني سويف', en: 'Beni Suef', cities: [{ ar: 'بني سويف', en: 'Beni Suef' }] },
  { code: '23', slug: 'fayoum', ar: 'الفيوم', en: 'Fayoum', cities: [{ ar: 'الفيوم', en: 'Fayoum' }] },
  { code: '24', slug: 'minya', ar: 'المنيا', en: 'Minya', cities: [{ ar: 'المنيا', en: 'Minya' }, { ar: 'ملوي', en: 'Mallawi' }] },
  { code: '25', slug: 'assiut', ar: 'أسيوط', en: 'Assiut', cities: [{ ar: 'أسيوط', en: 'Assiut' }] },
  { code: '26', slug: 'sohag', ar: 'سوهاج', en: 'Sohag', cities: [{ ar: 'سوهاج', en: 'Sohag' }] },
  { code: '27', slug: 'qena', ar: 'قنا', en: 'Qena', cities: [{ ar: 'قنا', en: 'Qena' }, { ar: 'نجع حمادي', en: 'Nag Hammadi' }] },
  { code: '28', slug: 'aswan', ar: 'أسوان', en: 'Aswan', cities: [{ ar: 'أسوان', en: 'Aswan' }] },
  { code: '29', slug: 'luxor', ar: 'الأقصر', en: 'Luxor', cities: [{ ar: 'الأقصر', en: 'Luxor' }] },
  { code: '31', slug: 'red-sea', ar: 'البحر الأحمر', en: 'Red Sea', cities: [{ ar: 'الغردقة', en: 'Hurghada' }] },
  { code: '32', slug: 'new-valley', ar: 'الوادي الجديد', en: 'New Valley', cities: [{ ar: 'الخارجة', en: 'Kharga' }] },
  { code: '33', slug: 'matrouh', ar: 'مطروح', en: 'Matrouh', cities: [{ ar: 'مرسى مطروح', en: 'Marsa Matrouh' }] },
  { code: '34', slug: 'north-sinai', ar: 'شمال سيناء', en: 'North Sinai', cities: [{ ar: 'العريش', en: 'Arish' }] },
  { code: '35', slug: 'south-sinai', ar: 'جنوب سيناء', en: 'South Sinai', cities: [{ ar: 'شرم الشيخ', en: 'Sharm El Sheikh' }, { ar: 'الطور', en: 'El Tor' }] },
];

/** Code 88 is used for people born outside Egypt. */
export const FOREIGN_BORN_CODE = '88';

export const GOVERNORATE_BY_CODE = new Map(GOVERNORATES.map((g) => [g.code, g]));
