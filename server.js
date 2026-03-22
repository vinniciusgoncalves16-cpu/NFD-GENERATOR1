const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
// Serve static client files
app.use(express.static(path.join(__dirname))); 

// Mapeamento local para salvar PDFs
const pdfDir = path.join(__dirname, 'pdfs');
if (!fs.existsSync(pdfDir)) {
    fs.mkdirSync(pdfDir);
}

// Config Multer para upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, pdfDir),
    filename: (req, file, cb) => {
        // o frontend vai mandar o arquivo com o nome exato "Cliente_Data.pdf"
        cb(null, file.originalname);
    }
});
const upload = multer({ storage });

let pool;

async function setupDatabase() {
    try {
        console.log("Tentando conectar ao MySQL...");
        const dbHost = process.env.DB_HOST || 'localhost';
        const dbUser = process.env.DB_USER || 'root';
        const dbPass = process.env.DB_PASS || '71916263';
        const dbName = process.env.DB_NAME || 'nfd_db';
        const dbPort = process.env.DB_PORT || 3306;

        // Conexão temporária genérica para criar o DB se não existir
        const tempConn = await mysql.createConnection({
            host: dbHost,
            user: dbUser,
            password: dbPass,
            port: dbPort
        });

        await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
        await tempConn.end();

        // Conexão definitiva ao pool
        pool = mysql.createPool({
            host: dbHost,
            user: dbUser,
            password: dbPass,
            database: dbName,
            port: dbPort,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS historico (
                id INT AUTO_INCREMENT PRIMARY KEY,
                cliente VARCHAR(255) NOT NULL,
                nf_origem VARCHAR(100),
                chave_acesso VARCHAR(50),
                data_emissao DATE,
                total DECIMAL(15, 2),
                arquivo_pdf VARCHAR(255),
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;
        await pool.query(createTableQuery);
        console.log("✅ Banco de dados MySQL (nfd_db) e tabela 'historico' prontos na porta padrão 3306.");
    } catch (e) {
        console.error("❌ Erro ao conectar ao MySQL:", e.message);
        console.log("Dica: Certifique-se que o usuário é 'root' e não possui senha, ou altere o server.js.");
    }
}

// Rotas da API

// Rota para receber os dados JSON + Arquivo PDF (Multipart/form-data)
app.post('/api/save-nfd', upload.single('pdf_file'), async (req, res) => {
    try {
        // Os campos do formulário chegam via req.body (Graças ao formData no front)
        const record = JSON.parse(req.body.nfd_data);
        const { cliente, nf_origem, chave_acesso, data_emissao, total } = record;
        const filename = req.file ? req.file.filename : null;

        if (pool) {
            const query = `
                INSERT INTO historico 
                (cliente, nf_origem, chave_acesso, data_emissao, total, arquivo_pdf) 
                VALUES (?, ?, ?, ?, ?, ?)
            `;
            await pool.execute(query, [
                cliente || 'Desconhecido', 
                nf_origem || null, 
                chave_acesso || null, 
                data_emissao || null, 
                total || 0, 
                filename
            ]);
        }

        res.json({ success: true, message: "Espelho NFD salvo com sucesso!", file: filename });
    } catch (e) {
        console.error("Erro na rota /save-nfd:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Listar Histórico
app.get('/api/historico', async (req, res) => {
    try {
        if (!pool) return res.status(500).json({ error: "Banco de dados não conectado." });
        const [rows] = await pool.query('SELECT * FROM historico ORDER BY criado_em DESC');
        res.json(rows);
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// Baixar ou visualizar o PDF da pasta
app.get('/api/pdfs/:filename', (req, res) => {
    const file = path.join(pdfDir, req.params.filename);
    if (fs.existsSync(file)) {
        res.sendFile(file);
    } else {
        res.status(404).send('PDF não encontrado.');
    }
});

app.listen(PORT, async () => {
    console.log(`🚀 Servidor Node no ar: http://localhost:${PORT}`);
    await setupDatabase();
});
