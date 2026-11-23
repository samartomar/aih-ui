import {action, checkbox, field, fileField, hint, input, node, section} from './dom.js';

export function checkedFiles(files = []) {
  if (!Array.isArray(files) || files.some(file => !file || typeof file.name !== 'string' || !file.name ||
    typeof file.text !== 'string' || typeof file.allowUpdates !== 'boolean')) throw Error('Invalid saved supporting files.');
  return files.map(({name, text, allowUpdates}) => ({name, text, allowUpdates}));
}

export function sourceFiles(host, api) {
  const list = node('div', null, 'ix-stack');
  function render() {
    const files = checkedFiles(api.draft.files);
    list.replaceChildren();
    for (const file of files) {
      const row = node('details');
      const changeFile = patch => api.change('files', checkedFiles(api.draft.files).map(entry => entry.name === file.name ? {...entry,...patch} : entry));
      row.append(node('summary',file.name),
        field('Supporting instructions', input(file.text, text => changeFile({text}), true)),
        checkbox('Allow suggested updates to this file',file.allowUpdates, allowUpdates => changeFile({allowUpdates})),
        action('Remove file',()=>{api.change('files',api.draft.files.filter(entry=>entry.name!==file.name));render();}));
      list.append(row);
    }
  }
  host.append(section('Your files', field('Source reference',input(api.draft.source,value=>api.change('source',value))),
    fileField('Add a supporting file','.md,.txt,.json,.yaml,.yml',async file=>{
      if (api.draft.files.some(entry=>entry.name===file.name)) throw Error('A file with this name already exists. Expand it to edit the saved copy.');
      const text=await file.text();
      if (text.includes('\0')) throw Error('Choose a text file.');
      api.change('files',[...api.draft.files,{name:file.name,text,allowUpdates:false}]);
      render();
    },api.status), hint('File contents are saved in this browser and included in exports.'),list));
  render();
}
