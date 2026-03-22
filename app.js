document.addEventListener('DOMContentLoaded', () => {
    // Setup references
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const workspace = document.getElementById('workspace');
    const refPanel = document.getElementById('reference-panel');
    const pdfViewer = document.getElementById('pdf-viewer');
    
    // Drag & Drop
    dropZone.onclick = () => fileInput.click();
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('dragover'); };
    dropZone.ondragleave = () => dropZone.classList.remove('dragover');
    dropZone.ondrop = (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        handleFile(e.dataTransfer.files[0]);
    };
    fileInput.onchange = (e) => handleFile(e.target.files[0]);

    function handleFile(file) {
        if (!file) return;
        workspace.classList.remove('hidden');

        if (file.name.toLowerCase().endsWith('.xml')) {
            refPanel.classList.add('hidden');
            workspace.classList.remove('split-active');
            readXML(file);
        } else if (file.type === 'application/pdf') {
            refPanel.classList.remove('hidden');
            workspace.classList.add('split-active');
            
            // Show PDF in iframe
            const fileURL = URL.createObjectURL(file);
            pdfViewer.src = fileURL;
            
            // Try to extract text using basic pdf.js
            extractPDFText(file);
        } else {
            alert("Por favor selecione um arquivo XML ou PDF.");
        }
    }

    // Parsing XML
    function readXML(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const parser = new DOMParser();
            const xml = parser.parseFromString(e.target.result, "application/xml");
            
            // Extract Data
            const emit = Array.from(xml.getElementsByTagName('*')).find(n => n.nodeName.toLowerCase() === 'emit');
            const ide = Array.from(xml.getElementsByTagName('*')).find(n => n.nodeName.toLowerCase() === 'ide');
            const prot = Array.from(xml.getElementsByTagName('*')).find(n => n.nodeName.toLowerCase() === 'infprot');
            
            if (emit) document.getElementById('fornecedor').value = emit.getElementsByTagName('xNome')[0]?.textContent || '';
            if (prot) document.getElementById('chave-acesso').value = prot.getElementsByTagName('chNFe')[0]?.textContent || '';
            if (ide) {
                document.getElementById('numero-nf').value = ide.getElementsByTagName('nNF')[0]?.textContent || '';
                const dhEmi = ide.getElementsByTagName('dhEmi')[0]?.textContent || '';
                if(dhEmi) document.getElementById('data-emissao').value = dhEmi.substring(0, 10);
            }
            
            // Clear table
            document.getElementById('products-body').innerHTML = '';
            
            const detNodes = Array.from(xml.getElementsByTagName('*')).filter(n => n.nodeName.toLowerCase() === 'det');
            detNodes.forEach(det => {
                const prod = Array.from(det.getElementsByTagName('*')).find(n => n.nodeName.toLowerCase() === 'prod');
                if(!prod) return;
                const cod = prod.getElementsByTagName('cProd')[0]?.textContent || '';
                const desc = prod.getElementsByTagName('xProd')[0]?.textContent || '';
                const ncm = prod.getElementsByTagName('NCM')[0]?.textContent || '';
                const qCom = parseFloat(prod.getElementsByTagName('qCom')[0]?.textContent || '0');
                const vUnCom = parseFloat(prod.getElementsByTagName('vUnCom')[0]?.textContent || '0');
                
                addProductRow(cod, desc, ncm, '5202', qCom, vUnCom);
            });
            updateTotal();
        };
        reader.readAsText(file);
    }
    
    async function extractPDFText(file) {
        try {
            if (!window.pdfjsLib) return;
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
            
            // Just read first page strings
            const page = await pdf.getPage(1);
            const textContent = await page.getTextContent();
            const fullText = textContent.items.map(item => item.str).join(' ');
            
            // Regex for 44 digit access key
            const chaveMatch = fullText.replaceAll(' ', '').match(/\d{44}/);
            if (chaveMatch) {
                document.getElementById('chave-acesso').value = chaveMatch[0];
            }
            
            // Regex for NF Number
            const nfMatch = fullText.match(/N[°º]?\s*(\d{1,9})/i) || fullText.match(/Nº\s*(\d+)/i) || fullText.match(/SÉRIE\s*\d+\s*(\d{1,9})/i);
            if(nfMatch) {
                document.getElementById('numero-nf').value = nfMatch[nfMatch.length - 1];
            }

            // Group by lines for table parsing
            let lines = [];
            const getLine = (y) => {
                for(let l of lines) {
                    if (Math.abs(l.y - y) < 4) return l;
                }
                let newL = {y: y, items: []};
                lines.push(newL);
                return newL;
            };
            
            for(let item of textContent.items) {
                const y = item.transform[5];
                const x = item.transform[4];
                const str = item.str.trim();
                if (str) {
                    getLine(y).items.push({x, str});
                }
            }
            
            lines.sort((a,b) => b.y - a.y);
            lines.forEach(l => l.items.sort((a,b) => a.x - b.x));
            
            let extractedProducts = [];
            for (let line of lines) {
                let lineText = line.items.map(i => i.str).join(' ');
                
                // Heuristics for DANFE product line: NCM (8 digits) + CFOP (4 digits)
                const ncmMatch = lineText.match(/\b\d{8}\b/);
                const cfopMatch = lineText.match(/\b[567]\d{3}\b/);
                
                if (ncmMatch && cfopMatch) {
                    const ncm = ncmMatch[0];
                    const cfopOrig = cfopMatch[0];
                    
                    const textBeforeNCM = lineText.substring(0, lineText.indexOf(ncm)).trim();
                    let code = '';
                    let desc = textBeforeNCM;
                    
                    const firstSpace = textBeforeNCM.indexOf(' ');
                    if (firstSpace > 0) {
                        code = textBeforeNCM.substring(0, firstSpace);
                        desc = textBeforeNCM.substring(firstSpace + 1).trim();
                    }

                    const textAfterCFOP = lineText.substring(lineText.indexOf(cfopOrig) + 4).trim();
                    const parts = textAfterCFOP.split(/\s+/);
                    let validNumbers = parts.filter(p => p.includes(',')); 
                    
                    let qtd = 1;
                    let vUnit = 0;
                    
                    if (validNumbers.length >= 2) {
                        qtd = parseFloat(validNumbers[0].replace(/\./g, '').replace(',', '.'));
                        vUnit = parseFloat(validNumbers[1].replace(/\./g, '').replace(',', '.'));
                    }

                    extractedProducts.push({
                        cod: code,
                        desc: desc, // PDF lines might cut descriptions, but it's enough for return item
                        ncm: ncm,
                        cfop: '5202',
                        qtd: qtd || 1,
                        val: vUnit || 0
                    });
                }
            }

            // Clear items for user input
            document.getElementById('products-body').innerHTML = '';
            
            if (extractedProducts.length > 0) {
                extractedProducts.forEach(p => {
                    addProductRow(p.cod, p.desc, p.ncm, p.cfop, p.qtd, p.val);
                });
            } else {
                addProductRow('','','','5202', 1, 0); // fallback
            }

            updateTotal();
            
        } catch(e) {
            console.error("Erro no PDF:", e);
            document.getElementById('products-body').innerHTML = '';
            addProductRow('','','','5202', 1, 0);
        }
    }

    // Dynamic Table
    const tbody = document.getElementById('products-body');
    document.getElementById('btn-add-product').onclick = () => addProductRow('','','','5202', 1, 0);

    function addProductRow(cod, desc, ncm, cfop, qtd, val) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="text" class="col-small cod" value="${cod}"></td>
            <td><input type="text" class="desc" value="${desc}"></td>
            <td><input type="text" class="col-small ncm" value="${ncm}" maxlength="8"></td>
            <td><input type="text" class="col-small cfop" value="${cfop}" maxlength="4"></td>
            <td><input type="number" class="col-small qtd" value="${qtd}" step="0.001" min="0"></td>
            <td><input type="number" class="col-medium val" value="${val}" step="0.01" min="0"></td>
            <td class="row-total" style="font-weight:600; padding-top:0.8rem;">R$ ${(qtd*val).toFixed(2)}</td>
            <td><button class="btn-danger remove-btn" title="Excluir">X</button></td>
        `;
        
        const updateRowTotal = () => {
            const q = parseFloat(tr.querySelector('.qtd').value) || 0;
            const v = parseFloat(tr.querySelector('.val').value) || 0;
            tr.querySelector('.row-total').textContent = `R$ ${(q*v).toFixed(2)}`;
            updateTotal();
        };

        tr.querySelector('.qtd').oninput = updateRowTotal;
        tr.querySelector('.val').oninput = updateRowTotal;
        tr.querySelector('.remove-btn').onclick = () => { tr.remove(); updateTotal(); };

        tbody.appendChild(tr);
    }

    function updateTotal() {
        let total = 0;
        document.querySelectorAll('#products-body tr').forEach(tr => {
            const q = parseFloat(tr.querySelector('.qtd').value) || 0;
            const v = parseFloat(tr.querySelector('.val').value) || 0;
            total += (q*v);
        });
        document.getElementById('total-produtos').textContent = `R$ ${total.toFixed(2)}`;
        document.getElementById('print-total-produtos').textContent = `R$ ${total.toFixed(2)}`;
    }

    // Save NFD (Frontend Auto-PDF -> MySQL)
    document.getElementById('btn-print').onclick = async () => {
        const btn = document.getElementById('btn-print');
        const originalText = btn.innerHTML;
        btn.innerHTML = "Gerando e Salvando...";
        btn.disabled = true;

        // Sync Data to Print Layout
        const clienteNome = document.getElementById('fornecedor').value || 'Desconhecido';
        document.getElementById('val-emitente').textContent = clienteNome;
        document.getElementById('val-nf').textContent = document.getElementById('numero-nf').value || '000.000';
        
        const dataOrig = document.getElementById('data-emissao').value;
        document.getElementById('val-data').textContent = dataOrig ? dataOrig.split('-').reverse().join('/') : '-';
        
        const chaveStr = document.getElementById('chave-acesso').value || '00000000000000000000000000000000000000000000';
        document.getElementById('val-chave').textContent = chaveStr.replace(/(.{4})/g, '$1 ').trim();
        document.getElementById('val-obs').textContent = document.getElementById('obs').value || 'Sem observações.';
        document.getElementById('val-total').textContent = document.getElementById('total-produtos').textContent;

        const printBody = document.getElementById('print-products-body');
        printBody.innerHTML = '';
        
        document.querySelectorAll('#products-body tr').forEach(tr => {
            const cod = tr.querySelector('.cod').value;
            const desc = tr.querySelector('.desc').value;
            const ncm = tr.querySelector('.ncm').value;
            const cfop = tr.querySelector('.cfop').value;
            const qtd = tr.querySelector('.qtd').value;
            const val = parseFloat(tr.querySelector('.val').value) || 0;
            
            printBody.innerHTML += `
                <tr>
                    <td style="text-align:center;">${cod}</td>
                    <td>${desc}</td>
                    <td style="text-align:center;">${ncm}</td>
                    <td style="text-align:center;">00</td>
                    <td style="text-align:center;">${cfop}</td>
                    <td style="text-align:center;">UN</td>
                    <td style="text-align:right;">${parseFloat(qtd).toFixed(4)}</td>
                    <td style="text-align:right;">${val.toFixed(4)}</td>
                    <td style="text-align:right;">${(parseFloat(qtd)*val).toFixed(2)}</td>
                    <td style="text-align:right;">0,00</td>
                </tr>
            `;
        });

        // Show print layout, hide main app safely
        const layout = document.querySelector('.print-layout');
        const appContainer = document.querySelector('.app-container');
        appContainer.style.display = 'none';
        layout.style.display = 'block';

        // Helper to format date
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];
        const safeCliente = clienteNome.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = `${safeCliente}_${dateStr}.pdf`;

        // Generate PDF Blob using html2pdf
        const opt = {
            margin:       0.2, // Reduced to avoid white borders
            filename:     filename,
            image:        { type: 'jpeg', quality: 1 },
            html2canvas:  { scale: 2, scrollX: 0, scrollY: 0 },
            jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' }
        };

        try {
            const pdfBlob = await html2pdf().set(opt).from(layout).output('blob');
            
            // Revert layout
            layout.style.display = 'none';
            appContainer.style.display = 'flex';

            // Gather JSON data
            const nfdData = {
                cliente: document.getElementById('fornecedor').value,
                nf_origem: document.getElementById('numero-nf').value,
                chave_acesso: document.getElementById('chave-acesso').value,
                data_emissao: dataOrig || dateStr,
                total: parseFloat(document.getElementById('total-produtos').textContent.replace('R$ ', '').replace('.', '').replace(',', '.')) || 0
            };

            // Build FormData
            const formData = new FormData();
            formData.append('pdf_file', pdfBlob, filename);
            formData.append('nfd_data', JSON.stringify(nfdData));

            // Send to Backend
            const response = await fetch('http://localhost:3000/api/save-nfd', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();
            if(result.success) {
                alert('Salvo com sucesso no Banco de Dados! Arquivo PDF armazenado.');
                // Optionally download locally as well
                const link = document.createElement('a');
                link.href = URL.createObjectURL(pdfBlob);
                link.download = filename;
                link.click();
            } else {
                alert('Erro ao salvar no Banco: ' + result.error);
            }

        } catch (e) {
            console.error(e);
            alert('Erro ao gerar o PDF.');
            layout.style.display = 'none';
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    };

    // Histórico Logic
    const histSection = document.getElementById('historico-section');
    const uploadSection = document.querySelector('.upload-section');
    
    document.getElementById('btn-historico').onclick = async () => {
        if(workspace && !workspace.classList.contains('hidden')) workspace.classList.add('hidden');
        uploadSection.classList.add('hidden');
        histSection.classList.remove('hidden');

        const tbody = document.getElementById('historico-body');
        tbody.innerHTML = '<tr><td colspan="6">Carregando...</td></tr>';

        try {
            const res = await fetch('http://localhost:3000/api/historico');
            const data = await res.json();
            
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6">Nenhum espelho salvo ainda.</td></tr>';
                return;
            }

            tbody.innerHTML = data.map(nfd => `
                <tr>
                    <td>${nfd.id}</td>
                    <td>${nfd.cliente}</td>
                    <td>${nfd.nf_origem || '-'}</td>
                    <td>R$ ${parseFloat(nfd.total).toFixed(2)}</td>
                    <td>${new Date(nfd.criado_em).toLocaleDateString('pt-BR')}</td>
                    <td>
                        ${nfd.arquivo_pdf ? `<a href="http://localhost:3000/api/pdfs/${nfd.arquivo_pdf}" target="_blank" style="color:#2563eb; text-decoration:underline;">Download/Ver PDF</a>` : '-'}
                    </td>
                </tr>
            `).join('');

        } catch(e) {
            tbody.innerHTML = '<tr><td colspan="6" style="color:red;">Erro de conexão com o banco! O Servidor Node está rodando?</td></tr>';
        }
    };

    document.getElementById('btn-voltar').onclick = () => {
        histSection.classList.add('hidden');
        uploadSection.classList.remove('hidden');
    };
});
