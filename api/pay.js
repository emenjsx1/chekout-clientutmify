require('dotenv').config();
const axios = require('axios');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido' });
  }

  try {
    // Validar variáveis de ambiente
    const requiredEnvVars = ['E2P_CLIENT_ID', 'E2P_CLIENT_SECRET', 'E2P_MPESA_WALLET', 'E2P_EMOLA_WALLET', 'UTMIFY_TOKEN'];
    const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);
    
    if (missingEnvVars.length > 0) {
      console.error('Variáveis de ambiente faltando:', missingEnvVars);
      return res.status(400).json({ 
        success: false, 
        message: 'Configuração do servidor incompleta',
        missing: missingEnvVars
      });
    }

    const { numero, metodo, nome, email, telefone, tracking } = req.body;

    // Validação básica
    if (!numero || !metodo || !nome || !email || !telefone) {
      return res.status(400).json({ success: false, message: 'Dados incompletos' });
    }
    
    // Configurações do Pedido
    const orderId = `ORD${Date.now()}`.slice(0, 20); // Limitar a 20 caracteres
    const valorMZN = 197.00;
    const dataAtual = new Date().toISOString().replace('T', ' ').split('.')[0];

    // Limpeza de número para 9 dígitos (sem 258)
    let cleanNumber = numero.replace(/\D/g, '');
    if (cleanNumber.startsWith('258')) cleanNumber = cleanNumber.slice(3);
    const finalNumber = cleanNumber.slice(-9);

    // Validar número
    if (finalNumber.length !== 9) {
      return res.status(400).json({ success: false, message: 'Número de telefone inválido' });
    }

    // Log para debug
    console.log(`[${new Date().toISOString()}] Iniciando pagamento:`, {
      orderId,
      metodo,
      phone: finalNumber,
      amount: valorMZN
    });

    // 1. ENVIAR PARA UTMIFY (opcional, não bloqueia o fluxo)
    axios.post('https://api.utmify.com.br/api-credentials/orders', {
      orderId: orderId,
      platform: "GlobalPay",
      paymentMethod: "pix",
      status: "waiting_payment",
      createdAt: dataAtual,
      customer: {
        name: nome,
        email: email,
        phone: telefone,
        country: "MZ"
      },
      trackingParameters: {
        utm_source: tracking?.utm_source || null,
        utm_campaign: tracking?.utm_campaign || null,
        utm_medium: tracking?.utm_medium || null,
        utm_content: tracking?.utm_content || null,
        utm_term: tracking?.utm_term || null
      }
    }, {
      headers: { 'x-api-token': process.env.UTMIFY_TOKEN }
    }).catch(e => console.error("Aviso - Utmify:", e.message));

    // 2. PROCESSAR COBRANÇA E2PAYMENTS
    console.log('Iniciando autenticação E2P...');
    
    const authResponse = await axios.post("https://e2payments.explicador.co.mz/oauth/token", {
      grant_type: "client_credentials",
      client_id: process.env.E2P_CLIENT_ID,
      client_secret: process.env.E2P_CLIENT_SECRET
    }, {
      timeout: 15000
    });

    const token = authResponse.data.access_token;
    if (!token) {
      throw new Error('Token não retornado pela E2P');
    }

    console.log('Token obtido com sucesso. Processando pagamento...');

    const wallet_id = metodo === 'mpesa' ? process.env.E2P_MPESA_WALLET : process.env.E2P_EMOLA_WALLET;

    const paymentResponse = await axios.post(
      `https://e2payments.explicador.co.mz/v1/c2b/${metodo}-payment/${wallet_id}`,
      {
        client_id: process.env.E2P_CLIENT_ID,
        amount: valorMZN.toString(),
        phone: finalNumber,
        reference: orderId
      },
      { 
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30000
      }
    );

    console.log('Pagamento processado com sucesso');

    // 3. ATUALIZAR UTMIFY COMO PAGO (opcional)
    axios.post('https://api.utmify.com.br/api-credentials/orders', {
      orderId: orderId,
      status: "paid",
      approvedDate: dataAtual
    }, {
      headers: { 'x-api-token': process.env.UTMIFY_TOKEN }
    }).catch(e => console.error("Aviso - Utmify Update:", e.message));

    return res.status(200).json({ 
      success: true, 
      data: paymentResponse.data,
      message: 'Pagamento processado com sucesso'
    });

  } catch (error) {
    console.error("Erro Geral:", {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      code: error.code
    });

    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Erro ao processar pagamento',
      error: error.response?.data || error.message,
      timestamp: new Date().toISOString()
    });
  }
};