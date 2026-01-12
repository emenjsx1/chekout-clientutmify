const axios = require('axios');

module.exports = async (req, res) => {
  // Configurações de CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { numero, metodo } = req.body;

  // Lógica para garantir que o número tenha apenas os 9 dígitos finais
  // Remove o prefixo 258 se o usuário o tiver incluído
  let cleanNumber = numero.replace(/\D/g, ''); // Remove tudo que não for número
  if (cleanNumber.startsWith('258')) {
    cleanNumber = cleanNumber.slice(3);
  }
  // Garante que ficamos apenas com os últimos 9 dígitos
  const finalNumber = cleanNumber.slice(-9);

  try {
    // 1. Obter Token (Credenciais seguras do .env) 
    const auth = await axios.post("https://e2payments.explicador.co.mz/oauth/token", {
      grant_type: "client_credentials",
      client_id: process.env.E2P_CLIENT_ID,
      client_secret: process.env.E2P_CLIENT_SECRET
    });

    const token = auth.data.access_token;
    
    // 2. Determinar a Carteira (Wallet) correta 
    const wallet_id = metodo === 'mpesa' ? process.env.E2P_MPESA_WALLET : process.env.E2P_EMOLA_WALLET;

    // 3. Chamada de Pagamento C2B
    const response = await axios.post(
      `https://e2payments.explicador.co.mz/v1/c2b/${metodo}-payment/${wallet_id}`,
      {
        client_id: process.env.E2P_CLIENT_ID,
        amount: "1",
        phone: finalNumber, // Enviando apenas os 9 dígitos
        reference: "TaxaGoogle"
      },
      { 
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        } 
      }
    );

    return res.status(200).json({ success: true, data: response.data });

  } catch (error) {
    console.error("Erro na API:", error.response?.data || error.message);
    return res.status(500).json({ 
      success: false, 
      details: error.response?.data || error.message 
    });
  }
};