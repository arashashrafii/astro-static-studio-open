import {useEffect, useRef, useState} from 'react';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import './collection-review-prototype.css';

type ReviewItem = {title: string; body: string; excerpt: string};
type ReviewCollection = {id: string; name: string; preset: 'generic' | 'project'; fields: string[]; items: ReviewItem[]};

function makeExcerpt(text: string) {
  return Array.from(text.replace(/\s+/gu, ' ').trim()).slice(0, 150).join('');
}

/** Local-only owner review screen. This component deliberately has no API or persistence calls. */
export default function CollectionReviewPrototype() {
  const [section, setSection] = useState<'pages' | 'collections'>('collections');
  const [collectionScreen, setCollectionScreen] = useState<'overview' | 'items' | 'new'>('overview');
  const [view, setView] = useState<'list' | 'form'>('list');
  const [collections, setCollections] = useState<ReviewCollection[]>([{id: 'projects-preset', name: 'پروژه‌ها', preset: 'project', fields: ['دسته‌بندی', 'گالری', 'متن', 'پیوند'], items: [{title: 'حجم آبی', body: '<p>روایتی از نور و فرم در فضای شهری.</p>', excerpt: 'روایتی از نور و فرم در فضای شهری.'}]}]);
  const [selectedCollectionId, setSelectedCollectionId] = useState('projects-preset');
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionPreset, setNewCollectionPreset] = useState<'generic' | 'project'>('generic');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('این اثر با الهام از نور و حرکت ساخته شده است.');
  const [notice, setNotice] = useState('');
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const quillRef = useRef<Quill | null>(null);
  const selectedCollection = collections.find(collection => collection.id === selectedCollectionId);
  const items = selectedCollection?.items ?? [];

  useEffect(() => {
    const host = editorHostRef.current;
    if (!host || section !== 'collections' || collectionScreen !== 'items' || view !== 'form') return;

    const currentItem = editingIndex === null ? null : selectedCollection?.items[editingIndex];
    let quill: Quill;
    const insertImagePreview = () => {
      const range = quill.getSelection(true) ?? {index: quill.getLength(), length: 0};
      const placeholder = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="220"><rect width="100%" height="100%" rx="18" fill="#e8edf6"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="24" fill="#53627b">پیش‌نمایش تصویر · بارگذاری نمایشی</text></svg>')}`;
      quill.insertEmbed(range.index, 'image', placeholder, 'user');
      quill.setSelection(range.index + 1, 0, 'silent');
      setNotice('تصویر نمونه به متن اضافه شد؛ بارگذاری واقعی در این نمونه فعال نیست.');
    };

    quill = new Quill(host, {
      theme: 'snow',
      formats: ['bold', 'italic', 'header', 'size', 'align', 'image'],
      modules: {
        toolbar: {
          container: [[{header: [2, false]}], ['bold', 'italic'], [{size: ['small', false, 'large']}], [{align: []}], ['image']],
          handlers: {image: insertImagePreview},
        },
      },
    });
    quill.root.setAttribute('dir', 'rtl');
    quill.root.setAttribute('aria-label', 'ویرایش متن');
    if (currentItem) quill.clipboard.dangerouslyPasteHTML(currentItem.body);
    else quill.setText(body);
    const updateBody = () => setBody(quill.getText());
    quill.on('text-change', updateBody);
    quillRef.current = quill;

    return () => {
      quill.off('text-change', updateBody);
      quillRef.current = null;
      host.previousElementSibling?.remove();
      host.classList.remove('ql-container', 'ql-snow');
      host.replaceChildren();
    };
  }, [collectionScreen, editingIndex, section, selectedCollectionId, view]);

  function saveItem() {
    const cleanTitle = title.trim() || 'مورد تازه';
    const quill = quillRef.current;
    const text = quill?.getText() ?? body;
    const saved = {title: cleanTitle, body: quill?.root.innerHTML ?? `<p>${text}</p>`, excerpt: makeExcerpt(text)};
    if (selectedCollection) setCollections(current => current.map(collection => collection.id !== selectedCollection.id ? collection : ({...collection, items: editingIndex === null ? [saved, ...collection.items] : collection.items.map((item, index) => index === editingIndex ? saved : item)})));
    setNotice('نمونه فقط در همین صفحه اضافه شد.');
    setView('list');
    setTitle('');
    setEditingIndex(null);
  }

  function editItem(item: ReviewItem, index: number) {
    setEditingIndex(index);
    setTitle(item.title);
    setBody(item.excerpt);
    setView('form');
    setNotice('');
  }

  function saveCollection() {
    const collection: ReviewCollection = {id: crypto.randomUUID(), name: newCollectionName.trim() || (newCollectionPreset === 'project' ? 'پروژه‌ها' : 'مجموعهٔ تازه'), preset: newCollectionPreset, fields: newCollectionPreset === 'project' ? ['دسته‌بندی', 'گالری', 'متن', 'پیوند'] : ['متن'], items: []};
    setCollections(current => [...current, collection]);
    setNotice('مجموعه فقط در همین صفحه اضافه شد.');
    setNewCollectionName('');
    setCollectionScreen('overview');
  }

  return <div className="crp" dir="rtl">
    <header className="crp-header"><div><span className="crp-eyebrow">پیش‌نمایش برای بازبینی</span><h1>مدیریت محتوا</h1></div><span className="crp-local">نمونهٔ محلی · بدون ذخیره‌سازی</span></header>
    <nav className="crp-tabs" aria-label="بخش‌ها">
      <button className={section === 'pages' ? 'selected' : ''} onClick={() => {setSection('pages'); setView('list')}}>صفحه‌ها</button>
      <button className={section === 'collections' ? 'selected' : ''} onClick={() => {setSection('collections'); setCollectionScreen('overview'); setView('list')}}>مجموعه‌ها</button>
    </nav>
    <main className="crp-main">
      {section === 'pages' ? <>
        <div className="crp-title-row"><div><p className="crp-eyebrow">صفحه‌های سایت</p><h2>صفحه‌ها</h2></div><button className="crp-primary" onClick={() => setNotice('ساخت صفحه در این نمونه نمایشی است.')}>＋ صفحهٔ تازه</button></div>
        <div className="crp-list">{['خانه', 'دربارهٔ من', 'تماس'].map((page, index) => <article className="crp-row" key={page}><div><strong>{page}</strong><small>/{['', 'about', 'contact'][index]}</small></div><div className="crp-actions"><button onClick={() => setNotice(`ویرایش «${page}» در نمونه نمایشی است.`)}>ویرایش</button><button onClick={() => setNotice('حذف در نمونه نمایشی غیرفعال است.')}>حذف</button></div></article>)}</div>
      </> : collectionScreen === 'overview' ? <>
        <div className="crp-title-row"><div><p className="crp-eyebrow">محتوای تکرارشوندهٔ سایت</p><h2>مجموعه‌ها</h2></div><button className="crp-primary" onClick={() => {setCollectionScreen('new'); setNotice('')}}>＋ مجموعهٔ تازه</button></div>
        <div className="crp-list">{collections.map(collection => <article className="crp-row" key={collection.id}><div><strong>{collection.name}</strong><small>{collection.preset === 'project' ? `الگوی آمادهٔ پروژه · ${collection.items.length} مورد` : `مجموعهٔ عمومی · ${collection.items.length} مورد`}</small></div><div className="crp-actions"><button onClick={() => {setSelectedCollectionId(collection.id); setCollectionScreen('items'); setView('list'); setNotice('')}}>ورود به مجموعه</button></div></article>)}</div>
      </> : collectionScreen === 'new' ? <>
        <div className="crp-form-heading"><button className="crp-back" onClick={() => setCollectionScreen('overview')}>← بازگشت به مجموعه‌ها</button><p className="crp-eyebrow">ساخت مجموعه</p><h2>مجموعهٔ تازه</h2></div>
        <label className="crp-field">نام مجموعه<input value={newCollectionName} onChange={event => setNewCollectionName(event.target.value)} placeholder="مثلاً نوشته‌ها"/></label>
        <section className="crp-field"><span className="crp-label">روش شروع</span><div className="crp-choice-row"><button className={newCollectionPreset === 'generic' ? 'active' : ''} onClick={() => setNewCollectionPreset('generic')}>مجموعهٔ ساده</button><button className={newCollectionPreset === 'project' ? 'active' : ''} onClick={() => setNewCollectionPreset('project')}>الگوی پروژه‌ها</button></div><p className="crp-hint">هر دو گزینه از یک مدل مجموعه استفاده می‌کنند؛ الگو فقط چند فیلد آماده می‌کند.</p></section>
        <section className="crp-field"><span className="crp-label">فیلدهای پایه</span><div className="crp-chips"><span>تصویر جلد</span><span>عنوان</span></div><p className="crp-hint">این فیلدها در همهٔ موارد مجموعه وجود دارند.</p></section>
        <section className="crp-field"><span className="crp-label">فیلدهای آماده</span>{newCollectionPreset === 'project' ? <div className="crp-chips">{['دسته‌بندی', 'گالری', 'متن', 'پیوند'].map(field => <span key={field}>{field}</span>)}</div> : <><div className="crp-chips"><span>متن</span></div><p className="crp-hint">یک فیلد متن برای محتوای هر مورد؛ فیلدهای اختیاری را می‌توانید بعداً اضافه کنید.</p></>}</section>
        <div className="crp-savebar"><button onClick={() => setCollectionScreen('overview')}>لغو</button><button className="crp-primary" onClick={saveCollection}>ساخت نمونه</button></div>
      </> : view === 'list' ? <>
        <div className="crp-title-row"><div><button className="crp-back" onClick={() => setCollectionScreen('overview')}>← بازگشت به مجموعه‌ها</button><p className="crp-eyebrow">{selectedCollection?.preset === 'project' ? 'الگوی آمادهٔ پروژه' : 'مجموعهٔ عمومی'}</p><h2>{selectedCollection?.name ?? 'مجموعه'}</h2></div><button className="crp-primary" onClick={() => {setEditingIndex(null);setTitle('');setBody('این اثر با الهام از نور و حرکت ساخته شده است.');setView('form'); setNotice('')}}>＋ افزودن مورد</button></div>
        <section className="crp-summary"><div className="crp-cover" aria-hidden="true">پیش‌نمایش تصویر جلد</div><div><h3>{selectedCollection?.name}</h3><p>{selectedCollection?.preset === 'project' ? 'یک مجموعهٔ آماده با فیلدهای پایه و فیلدهای اختیاری مخصوص پروژه.' : 'یک مجموعهٔ عمومی با فیلدهای پایه و یک فیلد متن برای محتوای هر مورد.'}</p><div className="crp-chips"><span>تصویر جلد</span><span>عنوان</span>{selectedCollection?.fields.map(field => <span key={field}>{field}</span>)}</div></div></section>
        <div className="crp-list-heading"><h3>موارد مجموعه</h3><span>{items.length} مورد</span></div>
        <div className="crp-list">{items.map((item, index) => <article className="crp-row" key={`${item.title}-${index}`}><div><strong>{item.title}</strong><small>{item.excerpt || 'توضیح کوتاهی ثبت نشده است.'}</small></div><div className="crp-actions"><button onClick={() => editItem(item, index)}>ویرایش</button><button onClick={() => setNotice('حذف در نمونه نمایشی غیرفعال است.')}>حذف</button></div></article>)}</div>
      </> : <>
        <div className="crp-form-heading"><button className="crp-back" onClick={() => setView('list')}>← بازگشت به {selectedCollection?.name ?? 'مجموعه'}</button><p className="crp-eyebrow">{selectedCollection?.name} / {editingIndex === null ? 'مورد تازه' : 'ویرایش مورد'}</p><h2>{editingIndex === null ? `افزودن مورد به ${selectedCollection?.name ?? 'مجموعه'}` : 'ویرایش مورد'}</h2></div>
        <label className="crp-field">عنوان<input value={title} onChange={event => setTitle(event.target.value)} placeholder="مثلاً حجم آبی"/></label>
        <section className="crp-field"><span className="crp-label">تصویر جلد</span><button className="crp-upload" onClick={() => setNotice('بارگذاری تصویر در نمونه فقط نمایشی است.')}>＋ انتخاب تصویر</button></section>
        <section className="crp-field"><span className="crp-label">متن</span>
          <div ref={editorHostRef} className="crp-quill-host" aria-label="ویرایش متن"/>
          <p className="crp-hint">در فهرست، ۱۵۰ نویسهٔ نخست این متن به‌عنوان خلاصه نمایش داده می‌شود.</p>
          <p className="crp-hint">دکمهٔ تصویر در نوار ابزار فقط یک پیش‌نمایش درج می‌کند؛ بارگذاری شبیه‌سازی شده است.</p>
        </section>
        {selectedCollection?.fields.includes('دسته‌بندی') && <section className="crp-field"><span className="crp-label">دسته‌بندی</span><button className="crp-upload" onClick={() => setNotice('این انتخاب در نمونه نمایشی فقط ظاهری است.')}>انتخاب دسته‌بندی</button></section>}
        <div className="crp-savebar"><button onClick={() => setView('list')}>لغو</button><button className="crp-primary" onClick={saveItem}>{editingIndex === null ? 'ذخیرهٔ نمونه' : 'ذخیرهٔ تغییرات'}</button></div>
      </>}
      {notice && <p role="status" className="crp-notice">{notice}</p>}
    </main>
    <footer className="crp-footer">این مسیر فقط برای بازبینی طراحی است و هیچ داده‌ای را در سایت ذخیره نمی‌کند.</footer>
  </div>;
}
