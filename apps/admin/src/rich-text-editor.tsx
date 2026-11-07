import React, {useEffect, useRef, useState} from 'react';
import Quill from 'quill';
import ImageBlot from 'quill/formats/image';
import 'quill/dist/quill.snow.css';

type ImagePlacement = 'inline'|'wrap-start'|'wrap-end'|'block-start'|'block-center'|'block-end';
type EditorInline = {type:'text';text:string;bold?:boolean;italic?:boolean;size?:'small'|'large'}|{type:'image';src:string;alt:string;title?:string;placement?:ImagePlacement};
export type EditorRichText = {blocks:Array<{type:'paragraph';align?:'left'|'center'|'right';content:EditorInline[]}|{type:'heading';level:2|3|4;align?:'left'|'center'|'right';content:EditorInline[]}>};
type DeltaImage = {src:string;alt:string;title?:string;placement?:ImagePlacement};
type DeltaOp = {insert: string | {image: DeltaImage}; attributes?: Record<string, unknown>};
type EditorProps = {value?: EditorRichText; body: string; direction?: 'ltr'|'rtl'; imageMode?:'alt-required'|'inline'; onChange(value: EditorRichText, body: string): void};

const BaseImage = ImageBlot as unknown as {new(...args: never[]): object; create(value: unknown): HTMLImageElement; value(node: HTMLImageElement): unknown; blotName: string; tagName: string};
class ManagedImageBlot extends (BaseImage as new(...args: never[])=>object) {
  static blotName = 'image';
  static tagName = 'IMG';
  static create(value: unknown): HTMLImageElement {
    const node = (BaseImage as unknown as {create(value: string): HTMLImageElement}).create('');
    if (!value || typeof value !== 'object') return node;
    const image = value as {src?: unknown; alt?: unknown;title?:unknown;placement?:unknown};
    if (typeof image.src === 'string' && /^\/media\/(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp$/.test(image.src)) node.setAttribute('src', image.src);
    if (typeof image.alt === 'string') node.setAttribute('alt', image.alt.slice(0, 500));
    if (typeof image.title === 'string') node.setAttribute('title',image.title.slice(0,500));
    if (['inline','wrap-start','wrap-end','block-start','block-center','block-end'].includes(String(image.placement))) node.setAttribute('data-placement',String(image.placement));
    return node;
  }
  static value(node: HTMLImageElement): DeltaImage {
    const placement=node.getAttribute('data-placement');
    const title=node.getAttribute('title');
    return {src: node.getAttribute('src') ?? '', alt: node.getAttribute('alt') ?? '', ...(title!==null?{title}:{}), ...(placement&&['inline','wrap-start','wrap-end','block-start','block-center','block-end'].includes(placement)?{placement:placement as ImagePlacement}:{})};
  }
}
Quill.register('formats/image', ManagedImageBlot as never, true);

function richTextToDelta(value?: EditorRichText, body=''): DeltaOp[] {
  if (!value) return [{insert: body}, {insert: '\n'}];
  const ops: DeltaOp[] = [];
  for (const block of value.blocks) {
    for (const node of block.content) {
      if (node.type === 'image') ops.push({insert: {image: {src: node.src, alt: node.alt,...('title' in node&&node.title!==undefined?{title:node.title}:{}),...('placement' in node&&node.placement?{placement:node.placement}:{})}}});
      else {
        const attributes: Record<string, unknown> = {};
        if (node.bold) attributes.bold = true;
        if (node.italic) attributes.italic = true;
        if (node.size) attributes.size = node.size;
        ops.push({insert: node.text, ...(Object.keys(attributes).length ? {attributes} : {})});
      }
    }
    const attributes: Record<string, unknown> = {};
    if (block.type === 'heading') attributes.header = block.level;
    if (block.align) attributes.align = block.align;
    ops.push({insert: '\n', ...(Object.keys(attributes).length ? {attributes} : {})});
  }
  if (!ops.length) ops.push({insert: '\n'});
  return ops;
}

function deltaToRichText(ops: DeltaOp[], allowEmptyImageAlt=false): EditorRichText {
  const blocks: EditorRichText['blocks'] = [];
  let content: EditorInline[] = [];
  let blockAttrs: Record<string, unknown> = {};
  const pushText = (text: string, attrs: Record<string, unknown>) => {
    if (!text) return;
      const node: Extract<EditorInline,{type:'text'}> = {type:'text',text};
    if (attrs.bold === true) node.bold = true;
    if (attrs.italic === true) node.italic = true;
    if (attrs.size === 'small' || attrs.size === 'large') node.size = attrs.size;
    content.push(node);
  };
  for (const op of ops) {
    const attrs = op.attributes ?? {};
    if (typeof op.insert === 'string') {
      const pieces = op.insert.split('\n');
      pieces.forEach((piece, index) => {
        pushText(piece, attrs);
        if (index < pieces.length - 1) {
          blockAttrs = attrs;
          const level = blockAttrs.header;
          const align = blockAttrs.align;
          if (level === 2 || level === 3 || level === 4) blocks.push({type:'heading',level, ...(align === 'left'||align === 'center'||align === 'right'?{align}:{}),content});
          else blocks.push({type:'paragraph', ...(align === 'left'||align === 'center'||align === 'right'?{align}:{}),content});
          content = [];
          blockAttrs = {};
        }
      });
    } else {
      const image = op.insert.image;
      if (/^\/media\/(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp$/.test(image.src) && (allowEmptyImageAlt||image.alt.trim())) content.push({type:'image',src:image.src,alt:image.alt,...(image.title!==undefined?{title:image.title}:{}),...(image.placement?{placement:image.placement}:{})});
    }
  }
  if (content.length) blocks.push({type:'paragraph', ...(blockAttrs.align==='left'||blockAttrs.align==='center'||blockAttrs.align==='right'?{align:blockAttrs.align}:{}),content});
  return {blocks};
}

function editorRichTextToPlainText(value:EditorRichText):string {
  return value.blocks.map(block=>block.content.map(node=>node.type==='text'?node.text:'').join('')).join('\n\n');
}

export function RichTextEditor({value, body, direction='rtl', imageMode='alt-required', onChange}: EditorProps) {
  const hostRef = useRef<HTMLDivElement|null>(null);
  const onChangeRef = useRef(onChange);
  const fileRef = useRef<HTMLInputElement|null>(null);
  const quillRef = useRef<Quill|null>(null);
  const selectionRef = useRef<{index:number;length:number}|null>(null);
  const [pendingImage, setPendingImage] = useState<{src:string;alt:string}>();
  const [uploadBusy, setUploadBusy] = useState(false);
  const [imageAlt, setImageAlt] = useState('');
  const [selectedImage,setSelectedImage]=useState<{index:number;media:DeltaImage}>();
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const quill = new Quill(host, {
      theme: 'snow',
      formats: ['bold','italic','header','size','align','image'],
      modules: {toolbar: {container: [[{header:[2,3,4,false]}],['bold','italic'],[{size:['small',false,'large']}],[{align:[]}],['image']],handlers:{image:()=>{const range=quill.getSelection();selectionRef.current=range?{index:range.index,length:range.length}:{index:Math.max(0,quill.getLength()-1),length:0};fileRef.current?.click()}}}},
    });
    quill.root.setAttribute('dir',direction);
    quill.root.setAttribute('aria-label','متن');
    quill.setContents(richTextToDelta(value,body) as never,'silent');
    const altsBySource = new Map<string,string[]>();
    for (const block of value?.blocks ?? []) {
      for (const node of block.content) {
        if (node.type !== 'image') continue;
        const alts = altsBySource.get(node.src) ?? [];
        alts.push(node.alt);
        altsBySource.set(node.src, alts);
      }
    }
    for (const image of quill.root.querySelectorAll('img')) {
      const alts = altsBySource.get(image.getAttribute('src') ?? '');
      const alt = alts?.shift();
      if (alt !== undefined) image.setAttribute('alt',alt);
    }
    const onImageClick=(event:MouseEvent)=>{
      const target=event.target;
      if(!(target instanceof HTMLImageElement)){setSelectedImage(undefined);return}
      const blot=Quill.find(target);
      if(!blot){setSelectedImage(undefined);return}
      const index=quill.getIndex(blot as never);
      const placement=target.getAttribute('data-placement');
      setSelectedImage({index,media:{src:target.getAttribute('src')??'',alt:target.getAttribute('alt')??'',...(placement&&['inline','wrap-start','wrap-end','block-start','block-center','block-end'].includes(placement)?{placement:placement as ImagePlacement}:{})}});
    };
    const onTab=(event:KeyboardEvent)=>{
      if(event.key!=='Tab'||document.activeElement!==quill.root)return;
      const focusable=Array.from(document.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]):not([type="file"]),select:not([disabled]),textarea:not([disabled]),[contenteditable="true"],[tabindex]:not([tabindex="-1"])'))
        .filter(element=>(element===quill.root||element.tabIndex>=0)&&!element.closest('[inert]')&&!element.closest('[aria-hidden="true"]')&&element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden');
      const current=focusable.indexOf(quill.root);
      if(current<0)return;
      event.preventDefault();
      event.stopImmediatePropagation();
      focusable[current+(event.shiftKey?-1:1)]?.focus();
    };
    quill.root.addEventListener('click',onImageClick);
    document.addEventListener('keydown',onTab,true);
    const update = () => {
      const richText = deltaToRichText(quill.getContents().ops as DeltaOp[],imageMode==='inline');
      onChangeRef.current(richText, editorRichTextToPlainText(richText));
    };
    quill.on('text-change',update);
    quillRef.current = quill;
    return () => {quill.off('text-change',update);quill.root.removeEventListener('click',onImageClick);document.removeEventListener('keydown',onTab,true);quillRef.current=null;host.previousElementSibling?.remove();host.classList.remove('ql-container','ql-snow');host.replaceChildren()};
  }, []);

  useEffect(() => {
    quillRef.current?.root.setAttribute('dir', direction);
  }, [direction]);

  async function uploadImage(file?: File) {
    if (!file) return;
    setUploadBusy(true);
    try {
      const form = new FormData(); form.append('image',file);
      const response = await fetch('/api/media',{method:'POST',body:form});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'بارگذاری تصویر انجام نشد.');
      const image={src:result.src,alt:''};
      if(imageMode==='inline')insertUploadedImage(image);
      else {setPendingImage(image); setImageAlt('')}
    } catch (error) {
      const message = error instanceof Error ? error.message : 'بارگذاری تصویر انجام نشد.';
      window.alert(message);
    } finally {setUploadBusy(false)}
  }

  function insertImage(event: React.FormEvent) {
    event.preventDefault();
    const image = pendingImage;
    if (!image || !imageAlt.trim()) return;
    insertUploadedImage({...image,alt:imageAlt.trim()});
    setPendingImage(undefined); setImageAlt('');
  }

  function insertUploadedImage(image:DeltaImage) {
    const quill = quillRef.current;
    if (!quill) return;
    const range = selectionRef.current ?? {index:Math.max(0,quill.getLength()-1),length:0};
    if (range.length) quill.deleteText(range.index,range.length,'user');
    const inserted={...image,...(imageMode==='inline'?{placement:'inline' as const}:{})};
    quill.insertEmbed(range.index,'image',inserted,'user');
    quill.setSelection(range.index+1,0,'silent');
    setSelectedImage({index:range.index,media:inserted});
  }

  function changeImagePlacement(placement:ImagePlacement) {
    const selection=selectedImage;
    const quill=quillRef.current;
    if(!selection||!quill)return;
    let cursor=0;
    const ops=(quill.getContents().ops as DeltaOp[]).map(op=>{
      const length=typeof op.insert==='string'?op.insert.length:1;
      if(cursor===selection.index&&typeof op.insert!=='string'){
        cursor+=length;
        return {...op,insert:{image:{...op.insert.image,placement}}};
      }
      cursor+=length;
      return op;
    });
    const media={...selection.media,placement};
    quill.setContents({ops} as never,'user');
    quill.setSelection(selection.index+1,0,'silent');
    setSelectedImage({index:selection.index,media});
  }

  const wrapStartLabel=direction==='rtl'?'شناور سمت راست با متن‌پیچی':'شناور سمت چپ با متن‌پیچی';
  const wrapEndLabel=direction==='rtl'?'شناور سمت چپ با متن‌پیچی':'شناور سمت راست با متن‌پیچی';
  const blockStartLabel=direction==='rtl'?'قرارگیری سمت راست':'قرارگیری سمت چپ';
  const blockEndLabel=direction==='rtl'?'قرارگیری سمت چپ':'قرارگیری سمت راست';
  return <div className="rich-text-editor">
    <div ref={hostRef}/>
    <input ref={fileRef} hidden type="file" accept="image/jpeg,image/png" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';void uploadImage(file)}}/>
    {uploadBusy&&<p className="hint" role="status">در حال بارگذاری تصویر…</p>}
    {selectedImage&&imageMode==='inline'&&<div className="rich-image-properties"><label>چیدمان تصویر<select aria-label="چیدمان تصویر" value={selectedImage.media.placement??'inline'} onChange={event=>changeImagePlacement(event.target.value as ImagePlacement)}><option value="inline">هم‌ردیف متن</option><option value="wrap-start">{wrapStartLabel}</option><option value="wrap-end">{wrapEndLabel}</option><option value="block-start">{blockStartLabel}</option><option value="block-center">وسط‌چین</option><option value="block-end">{blockEndLabel}</option></select></label></div>}
    {pendingImage&&imageMode==='alt-required'&&<form className="rich-image-alt" onSubmit={insertImage}><label>توضیح تصویر<input autoFocus required maxLength={500} value={imageAlt} onChange={event=>setImageAlt(event.target.value)} placeholder="تصویر چه چیزی را نشان می‌دهد؟"/></label><div className="actions"><button type="submit" disabled={!imageAlt.trim()}>افزودن به متن</button><button type="button" onClick={()=>setPendingImage(undefined)}>لغو</button></div></form>}
  </div>;
}
