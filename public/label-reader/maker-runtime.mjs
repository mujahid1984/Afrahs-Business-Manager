import * as reader from './pdf.min.mjs';
import * as writer from './pdf-writer.mjs';
reader.GlobalWorkerOptions.workerSrc='/label-reader/pdf.worker.min.mjs';
window.afrahLabelTools={reader,writer};
