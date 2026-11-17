/** Seeded Egyptian specialty catalogue (FR-ORG-2). */
export const SPECIALTIES: { slug: string; ar: string; en: string }[] = [
  { slug: 'general-practice', ar: 'ممارس عام', en: 'General Practice' },
  { slug: 'internal-medicine', ar: 'باطنة', en: 'Internal Medicine' },
  { slug: 'paediatrics', ar: 'أطفال وحديثي الولادة', en: 'Paediatrics' },
  { slug: 'obgyn', ar: 'نساء وتوليد', en: 'Obstetrics & Gynaecology' },
  { slug: 'dermatology', ar: 'جلدية', en: 'Dermatology' },
  { slug: 'dentistry', ar: 'أسنان', en: 'Dentistry' },
  { slug: 'orthopaedics', ar: 'عظام', en: 'Orthopaedics' },
  { slug: 'physiotherapy', ar: 'علاج طبيعي', en: 'Physiotherapy' },
  { slug: 'ophthalmology', ar: 'رمد', en: 'Ophthalmology' },
  { slug: 'ent', ar: 'أنف وأذن وحنجرة', en: 'ENT' },
  { slug: 'cardiology', ar: 'قلب وأوعية دموية', en: 'Cardiology' },
  { slug: 'neurology', ar: 'مخ وأعصاب', en: 'Neurology' },
  { slug: 'psychiatry', ar: 'نفسية', en: 'Psychiatry' },
  { slug: 'urology', ar: 'مسالك بولية', en: 'Urology' },
  { slug: 'endocrinology', ar: 'غدد صماء وسكر', en: 'Endocrinology & Diabetes' },
  { slug: 'gastroenterology', ar: 'جهاز هضمي ومناظير', en: 'Gastroenterology' },
  { slug: 'chest', ar: 'صدر', en: 'Chest Medicine' },
  { slug: 'nutrition', ar: 'تغذية', en: 'Nutrition' },
  { slug: 'general-surgery', ar: 'جراحة عامة', en: 'General Surgery' },
];

/** A starter ICD-10 subset common in Egyptian outpatient care. The full code set is imported (docs/runbooks/reference-data.md). */
export const ICD10: { code: string; en: string; ar: string }[] = [
  { code: 'I10', en: 'Essential (primary) hypertension', ar: 'ارتفاع ضغط الدم الأساسي' },
  { code: 'E11.9', en: 'Type 2 diabetes mellitus without complications', ar: 'السكري من النوع الثاني بدون مضاعفات' },
  { code: 'E78.5', en: 'Hyperlipidaemia, unspecified', ar: 'ارتفاع دهون الدم' },
  { code: 'J06.9', en: 'Acute upper respiratory infection, unspecified', ar: 'عدوى حادة بالجهاز التنفسي العلوي' },
  { code: 'J02.9', en: 'Acute pharyngitis, unspecified', ar: 'التهاب البلعوم الحاد' },
  { code: 'J45.9', en: 'Asthma, unspecified', ar: 'الربو' },
  { code: 'K21.9', en: 'Gastro-oesophageal reflux disease without oesophagitis', ar: 'ارتجاع المريء' },
  { code: 'K29.7', en: 'Gastritis, unspecified', ar: 'التهاب المعدة' },
  { code: 'A09', en: 'Infectious gastroenteritis and colitis, unspecified', ar: 'نزلة معوية معدية' },
  { code: 'N39.0', en: 'Urinary tract infection, site not specified', ar: 'التهاب المسالك البولية' },
  { code: 'M54.5', en: 'Low back pain', ar: 'آلام أسفل الظهر' },
  { code: 'M17.9', en: 'Gonarthrosis, unspecified', ar: 'خشونة الركبة' },
  { code: 'L20.9', en: 'Atopic dermatitis, unspecified', ar: 'التهاب الجلد التأتبي' },
  { code: 'L70.0', en: 'Acne vulgaris', ar: 'حب الشباب' },
  { code: 'H10.9', en: 'Conjunctivitis, unspecified', ar: 'التهاب الملتحمة' },
  { code: 'H52.1', en: 'Myopia', ar: 'قصر النظر' },
  { code: 'O80', en: 'Single spontaneous delivery', ar: 'ولادة طبيعية' },
  { code: 'Z34.9', en: 'Supervision of normal pregnancy, unspecified', ar: 'متابعة حمل طبيعي' },
  { code: 'D50.9', en: 'Iron deficiency anaemia, unspecified', ar: 'أنيميا نقص الحديد' },
  { code: 'E03.9', en: 'Hypothyroidism, unspecified', ar: 'قصور الغدة الدرقية' },
  { code: 'F41.1', en: 'Generalised anxiety disorder', ar: 'اضطراب القلق العام' },
  { code: 'K02.9', en: 'Dental caries, unspecified', ar: 'تسوس الأسنان' },
  { code: 'R50.9', en: 'Fever, unspecified', ar: 'حمى' },
  { code: 'R51', en: 'Headache', ar: 'صداع' },
  { code: 'Z00.0', en: 'General adult medical examination', ar: 'فحص طبي عام' },
  { code: 'Z23', en: 'Encounter for immunisation', ar: 'تطعيم' },
];

/** Sample drug rows; the licensed Egyptian drug list is imported per decision D10. */
export const DRUGS: { en: string; ar: string; ingredients: string[]; strength: string; form: string; manufacturer: string; price: number }[] = [
  { en: 'Panadol', ar: 'بنادول', ingredients: ['paracetamol'], strength: '500 mg', form: 'tablet', manufacturer: 'GSK', price: 3500 },
  { en: 'Cetal', ar: 'سيتال', ingredients: ['paracetamol'], strength: '500 mg', form: 'tablet', manufacturer: 'EIPICO', price: 1800 },
  { en: 'Augmentin', ar: 'أوجمنتين', ingredients: ['amoxicillin', 'clavulanic acid'], strength: '1 g', form: 'tablet', manufacturer: 'GSK', price: 9800 },
  { en: 'Brufen', ar: 'بروفين', ingredients: ['ibuprofen'], strength: '400 mg', form: 'tablet', manufacturer: 'Abbott', price: 4200 },
  { en: 'Concor', ar: 'كونكور', ingredients: ['bisoprolol'], strength: '5 mg', form: 'tablet', manufacturer: 'Merck', price: 6100 },
  { en: 'Glucophage', ar: 'جلوكوفاج', ingredients: ['metformin'], strength: '1000 mg', form: 'tablet', manufacturer: 'Merck', price: 5200 },
  { en: 'Nexium', ar: 'نيكسيوم', ingredients: ['esomeprazole'], strength: '40 mg', form: 'tablet', manufacturer: 'AstraZeneca', price: 15800 },
  { en: 'Antinal', ar: 'أنتينال', ingredients: ['nifuroxazide'], strength: '200 mg', form: 'capsule', manufacturer: 'Amoun', price: 2700 },
  { en: 'Zyrtec', ar: 'زيرتك', ingredients: ['cetirizine'], strength: '10 mg', form: 'tablet', manufacturer: 'GSK', price: 3900 },
  { en: 'Ventolin', ar: 'فنتولين', ingredients: ['salbutamol'], strength: '100 mcg', form: 'inhaler', manufacturer: 'GSK', price: 5500 },
  { en: 'Flagyl', ar: 'فلاجيل', ingredients: ['metronidazole'], strength: '500 mg', form: 'tablet', manufacturer: 'Sanofi', price: 2400 },
  { en: 'Voltaren', ar: 'فولتارين', ingredients: ['diclofenac'], strength: '50 mg', form: 'tablet', manufacturer: 'Novartis', price: 4600 },
];

export const LAB_TESTS: { code: string; kind: 'lab' | 'radiology'; en: string; ar: string }[] = [
  { code: 'CBC', kind: 'lab', en: 'Complete blood count', ar: 'صورة دم كاملة' },
  { code: 'FBS', kind: 'lab', en: 'Fasting blood sugar', ar: 'سكر صائم' },
  { code: 'HBA1C', kind: 'lab', en: 'HbA1c', ar: 'السكر التراكمي' },
  { code: 'LIPID', kind: 'lab', en: 'Lipid profile', ar: 'دهون الدم' },
  { code: 'TSH', kind: 'lab', en: 'TSH', ar: 'هرمون الغدة الدرقية' },
  { code: 'CREAT', kind: 'lab', en: 'Serum creatinine', ar: 'كرياتينين' },
  { code: 'ALT', kind: 'lab', en: 'ALT (SGPT)', ar: 'إنزيمات الكبد' },
  { code: 'URINE', kind: 'lab', en: 'Urine analysis', ar: 'تحليل بول' },
  { code: 'CXR', kind: 'radiology', en: 'Chest X-ray', ar: 'أشعة صدر' },
  { code: 'US-ABD', kind: 'radiology', en: 'Abdominal ultrasound', ar: 'سونار بطن' },
  { code: 'ECHO', kind: 'radiology', en: 'Echocardiography', ar: 'إيكو على القلب' },
  { code: 'MRI-LS', kind: 'radiology', en: 'MRI lumbosacral spine', ar: 'رنين مغناطيسي فقرات قطنية' },
];

/** Shipped specialty encounter templates (FR-EMR-3). */
export const ENCOUNTER_TEMPLATES: { specialty: string; ar: string; en: string; sections: string[]; diagnoses: string[] }[] = [
  { specialty: 'general-practice', ar: 'ممارس عام', en: 'General Practice', sections: ['vitals', 'chiefComplaint', 'hpi', 'examination', 'diagnoses', 'notes', 'prescriptions', 'followUp'], diagnoses: ['J06.9', 'R50.9', 'R51'] },
  { specialty: 'internal-medicine', ar: 'باطنة', en: 'Internal Medicine', sections: ['vitals', 'chiefComplaint', 'hpi', 'examination', 'diagnoses', 'problems', 'orders', 'prescriptions', 'followUp'], diagnoses: ['I10', 'E11.9', 'K29.7'] },
  { specialty: 'paediatrics', ar: 'أطفال', en: 'Paediatrics', sections: ['vitals', 'chiefComplaint', 'hpi', 'examination', 'diagnoses', 'observations', 'prescriptions', 'followUp'], diagnoses: ['J02.9', 'A09', 'Z23'] },
  { specialty: 'obgyn', ar: 'نساء وتوليد', en: 'Obstetrics & Gynaecology', sections: ['vitals', 'chiefComplaint', 'hpi', 'examination', 'observations', 'diagnoses', 'orders', 'prescriptions', 'followUp'], diagnoses: ['Z34.9', 'D50.9'] },
  { specialty: 'dermatology', ar: 'جلدية', en: 'Dermatology', sections: ['chiefComplaint', 'hpi', 'examination', 'bodyChart', 'diagnoses', 'prescriptions', 'followUp'], diagnoses: ['L20.9', 'L70.0'] },
  { specialty: 'orthopaedics', ar: 'عظام', en: 'Orthopaedics', sections: ['vitals', 'chiefComplaint', 'hpi', 'examination', 'bodyChart', 'diagnoses', 'orders', 'prescriptions', 'followUp'], diagnoses: ['M54.5', 'M17.9'] },
  { specialty: 'physiotherapy', ar: 'علاج طبيعي', en: 'Physiotherapy', sections: ['chiefComplaint', 'examination', 'bodyChart', 'observations', 'notes', 'followUp'], diagnoses: ['M54.5'] },
  { specialty: 'ophthalmology', ar: 'رمد', en: 'Ophthalmology', sections: ['chiefComplaint', 'hpi', 'examination', 'observations', 'diagnoses', 'prescriptions', 'followUp'], diagnoses: ['H10.9', 'H52.1'] },
  { specialty: 'dentistry', ar: 'أسنان', en: 'Dentistry', sections: ['chiefComplaint', 'examination', 'diagnoses', 'notes', 'prescriptions', 'followUp'], diagnoses: ['K02.9'] },
];

/** Sample interaction pairs (ingredient_a < ingredient_b). The licensed interaction dataset replaces these (D10). */
export const INTERACTIONS: { a: string; b: string; severity: 'minor' | 'moderate' | 'major' | 'contraindicated'; en: string; ar: string }[] = [
  { a: 'aspirin', b: 'warfarin', severity: 'major', en: 'Increased bleeding risk', ar: 'زيادة خطر النزيف' },
  { a: 'ibuprofen', b: 'warfarin', severity: 'major', en: 'Increased bleeding risk', ar: 'زيادة خطر النزيف' },
  { a: 'diclofenac', b: 'ibuprofen', severity: 'moderate', en: 'Two NSAIDs: GI bleeding and renal risk', ar: 'مسكنان من نفس المجموعة: خطر نزيف معدي وتأثير على الكلى' },
  { a: 'bisoprolol', b: 'verapamil', severity: 'major', en: 'Bradycardia and heart block', ar: 'بطء شديد في القلب' },
  { a: 'metronidazole', b: 'warfarin', severity: 'major', en: 'Raised INR', ar: 'ارتفاع سيولة الدم' },
  { a: 'clarithromycin', b: 'simvastatin', severity: 'contraindicated', en: 'Rhabdomyolysis risk', ar: 'خطر تكسر العضلات' },
  { a: 'esomeprazole', b: 'clopidogrel', severity: 'moderate', en: 'Reduced antiplatelet effect', ar: 'تقليل فاعلية مضاد الصفائح' },
  { a: 'metformin', b: 'contrast media', severity: 'major', en: 'Lactic acidosis risk', ar: 'خطر الحماض اللبني' },
];
