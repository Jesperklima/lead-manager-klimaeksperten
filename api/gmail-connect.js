export default function handler(req,res){
  const id=process.env.GOOGLE_CLIENT_ID;
  const redirect=process.env.GMAIL_REDIRECT_URI;
  if(!id||!redirect) return res.status(503).json({error:"Gmail OAuth er ikke konfigureret endnu."});
  const state=crypto.randomUUID();
  const scope=encodeURIComponent("https://www.googleapis.com/auth/gmail.readonly");
  const url="https://accounts.google.com/o/oauth2/v2/auth?client_id="+encodeURIComponent(id)+"&redirect_uri="+encodeURIComponent(redirect)+"&response_type=code&access_type=offline&prompt=consent&scope="+scope+"&state="+encodeURIComponent(state);
  res.redirect(url);
}