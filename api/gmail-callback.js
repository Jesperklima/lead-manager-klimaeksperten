export default async function handler(req,res){
  if(!req.query.code) return res.status(400).send("Mangler Google-godkendelseskode.");
  res.status(200).send("<!doctype html><html><body style='font-family:system-ui;padding:40px'><h1>Gmail-godkendelse modtaget</h1><p>Forbindelsen skal nu færdiggøres på serveren.</p><p>Du kan lukke dette vindue.</p></body></html>");
}