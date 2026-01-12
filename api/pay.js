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

  // Validar variáveis de ambiente
  const requiredEnvVars = ['E2P_CLIENT_ID', 'E2P_CLIENT_SECRET', 'E2P_MPESA_WALLET', 'E2P_EMOLA_WALLET', 'UTMIFY_TOKEN'];
  const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);
  
  if (missingEnvVars.length > 0) {
    console.error('Variáveis de ambiente faltando:', missingEnvVars);
    return res.status(500).json({ 
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
  const orderId = `ORD-${Date.now()}`;
  const valorMZN = 197.00;
  const valorCentavos = 19700; // Utmify pede em centavos
  const dataAtual = new Date().toISOString().replace('T', ' ').split('.')[0];

  // Limpeza de número para 9 dígitos (sem 258)
  let cleanNumber = numero.replace(/\D/g, '');
  if (cleanNumber.startsWith('258')) cleanNumber = cleanNumber.slice(3);
  const finalNumber = cleanNumber.slice(-9);

  try {
    // ------------------------------------------------------------
    // 1. UTMIFY - ENVIO DE VENDA PENDENTE (Waiting Payment)
    // ------------------------------------------------------------
    const utmifyPayload = {
      orderId: orderId,
      platform: "GlobalPay",
      paymentMethod: "pix", // Usamos pix como equivalente a mobile money instantâneo
      status: "waiting_payment",
      createdAt: dataAtual,
      approvedDate: null,
      refundedAt: null,
      customer: {
        name: nome,
        email: email,
        phone: telefone,
        document: null,
        country: "MZ"
      },
      products: [{
        id: "ativa-google",
        name: "Taxa de Ativação Google",
        quantity: 197,
        priceInCents: valorCentavos
      }],
      trackingParameters: {
        utm_source: tracking?.utm_source || req.body.utm_source || null,
        utm_campaign: tracking?.utm_campaign || req.body.utm_campaign || null,
        utm_medium: tracking?.utm_medium || req.body.utm_medium || null,
        utm_content: tracking?.utm_content || req.body.utm_content || null,
        utm_term: tracking?.utm_term || req.body.utm_term || null
      },
      commission: {
        totalPriceInCents: valorCentavos,
        gatewayFeeInCents: Math.round(valorCentavos * 0.03), // Exemplo: 3% de taxa
        userCommissionInCents: Math.round(valorCentavos * 0.97)
      }
    };

    await axios.post('https://api.utmify.com.br/api-credentials/orders', utmifyPayload, {
      headers: { 'x-api-token': process.env.UTMIFY_TOKEN }
    }).catch(e => console.error("Erro Utmify Pendente:", e.message));

    // ------------------------------------------------------------
    // 2. E2PAYMENTS - PROCESSAR COBRANÇA
    // ------------------------------------------------------------
    let auth;
    try {
      auth = await axios.post("https://e2payments.explicador.co.mz/oauth/token", {
        grant_type: "client_credentials",
        client_id: process.env.E2P_CLIENT_ID,
        client_secret: process.env.E2P_CLIENT_SECRET
      });
    } catch (authError) {
      console.error("Erro na autenticação E2P:", authError.response?.data || authError.message);
      return res.status(500).json({ 
        success: false, 
        message: 'Erro na autenticação com provedor de pagamento',
        error: authError.response?.data?.error_description || authError.message
      });
    }

    const token = auth.data.access_token;
    const wallet_id = metodo === 'mpesa' ? process.env.E2P_MPESA_WALLET : process.env.E2P_EMOLA_WALLET;

    let e2pResponse;
    try {
      e2pResponse = await axios.post(
        `https://e2payments.explicador.co.mz/v1/c2b/${metodo}-payment/${wallet_id}`,
        {
          client_id: process.env.E2P_CLIENT_ID,
          amount: valorMZN.toString(),
          phone: finalNumber,
          reference: orderId
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (paymentError) {
      console.error("Erro na requisição de pagamento E2P:", paymentError.response?.data || paymentError.message);
      return res.status(500).json({ 
        success: false, 
        message: 'Erro ao processar pagamento',
        error: paymentError.response?.data || paymentError.message
      });
    }

    // ------------------------------------------------------------
    // 3. UTMIFY - ATUALIZAR PARA PAGO (Paid)
    // ------------------------------------------------------------
    const utmifyPaidPayload = { 
      ...utmifyPayload, 
      status: "paid", 
      approvedDate: dataAtual 
    };

    await axios.post('https://api.utmify.com.br/api-credentials/orders', utmifyPaidPayload, {
      headers: { 'x-api-token': process.env.UTMIFY_TOKEN }
    }).catch(e => console.error("Erro Utmify Pago:", e.message));

    return res.status(200).json({ success: true, data: e2pResponse.data, message: 'Pagamento processado com sucesso' });

  } catch (error) {
    console.error("Erro Geral:", error.response?.data || error.message);
    console.error("Stack:", error.stack);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Erro ao processar pagamento',
      error: error.response?.data || null
    });
  }
};