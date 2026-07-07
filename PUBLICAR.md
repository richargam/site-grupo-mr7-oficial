# PUBLICAÇÃO SEGURA — SITE GRUPO MR7

## 1. Estrutura das branches

- **master**:
  desenvolvimento e validação;
  qualquer push deve gerar somente **Preview** na Vercel.

- **production**:
  versão oficial do site;
  somente push nessa branch pode atualizar a **Produção**.

- **Production Branch configurada na Vercel**:
  `production`.

## 2. Fluxo de desenvolvimento

Usar os comandos:

```bash
git switch master
git pull --ff-only origin master
```

Após concluir e aprovar uma alteração:

```bash
git add <arquivos-específicos>
git commit -m "mensagem do commit"
git push origin master
```

Depois:

- aguardar o **Preview automático** da Vercel;
- abrir a URL do Preview;
- validar **desktop** e **mobile**;
- conferir textos, imagens, links e responsividade;
- **não promover nada sem aprovação explícita**.

## 3. Fluxo de publicação em Produção

Somente após a aprovação do Preview:

```bash
git switch production
git pull --ff-only origin production
git merge --ff-only master
git push origin production
git switch master
```

Observações importantes:

- **`merge --ff-only`** impede a criação de histórico inesperado (sem merge-commit automático);
- se o comando **falhar**, o processo **deve parar** imediatamente;
- **não usar** `merge` comum automaticamente;
- **não resolver conflito** sem autorização;
- **somente o push em `production`** altera o site público.

## 4. Checklist antes da Produção

- [ ] Preview aprovado;
- [ ] desktop validado;
- [ ] mobile validado;
- [ ] imagens sem falhas;
- [ ] links testados;
- [ ] nenhuma credencial ou arquivo sensível;
- [ ] `git status` revisado;
- [ ] commits corretos;
- [ ] branch `production` sincronizada;
- [ ] autorização explícita do RicharGam.

## 5. Regras proibidas

Nunca usar automaticamente:

- `git push --force`
- `git push --force-with-lease`
- `git reset --hard`
- `rebase`
- `merge` com conflitos
- publicação direta da `master`
- alteração de DNS ou domínio
- promoção para Produção sem aprovação.

## 6. Reversão segura

Em caso de problema:

- **parar** novas publicações;
- **identificar** o último commit estável;
- preferir **`git revert`** em vez de apagar histórico;
- ou **restaurar um deploy anterior** aprovado pelo painel da Vercel;
- **nunca** usar `reset` ou `--force` sem autorização técnica explícita.

## 7. Estado atual documentado

- **Repositório**:
  https://github.com/richargam/site-grupo-mr7-oficial.git

- **Branch de desenvolvimento**:
  `master`

- **Branch de Produção**:
  `production`

- **Commit atualmente compartilhado pelas duas**:
  `0cd063c`

- **Domínio público**:
  https://site-grupo-mr7-oficial.vercel.app
