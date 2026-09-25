# Atalho "Rotina Saúde" — Lifesum → Apple Saúde → Rotina

Um Atalho do iPhone lê o que o Lifesum gravou no Apple Saúde hoje (calorias, proteína, carboidratos, gordura e água) e manda pra aba **Saúde** da sua planilha. O Rotina mostra os números na seção **comida**, e o Claude consegue ler junto com o resto.

Leva uns 10 minutos, uma vez só. Precisa que a planilha já esteja conectada (README, passo 3). Se você colou uma versão antiga do `Code.gs`, cole a nova e publique uma nova versão (Implantar → Gerenciar implantações → editar → Nova versão) e rode `setup` de novo pra criar a aba **Saúde**.

> Os nomes das ações podem variar um pouco conforme a versão do iOS. Em inglês estão entre parênteses. Na busca de ações, digitar "Saúde" ou "Health" encontra quase tudo.

## 1. Lifesum → Apple Saúde

No Lifesum: **Perfil → Configurações → Apps e dispositivos → Apple Saúde** (o caminho pode mudar um pouco) e permita gravar **nutrição** (energia, proteína, carboidratos, gordura) e **água**.

Depois de registrar uma refeição, confira no app Saúde → Navegar → Nutrição se os números apareceram.

## 2. Criar o atalho

App **Atalhos** → **+** → renomeie para exatamente **`Rotina Saúde`** (o botão "atualizar" do app abre o atalho por esse nome).

Repita este bloco de 3 ações para cada item da tabela:

1. **Buscar Amostras de Saúde** (Find Health Samples)
   - Tipo: *(coluna "Tipo no Saúde")*
   - Adicionar filtro: **Data de Início** · **é hoje**
   - Limite: desligado
2. **Obter Detalhes das Amostras de Saúde** (Get Details of Health Samples) → **Valor** (Value)
3. **Definir Variável** (Set Variable) → nome da coluna "Variável"

| Tipo no Saúde | Variável |
|---|---|
| Energia Alimentar (Dietary Energy) | `kcal` |
| Proteína (Protein) | `protein` |
| Carboidratos (Carbohydrates) | `carbs` |
| Gordura Total (Total Fat) | `fat` |
| Água (Water) | `water` |

Por último, adicione **Obter Conteúdo do URL** (Get Contents of URL):

- URL: o mesmo link do script que está no app (termina em `/exec`)
- Toque em **Mostrar Mais**:
  - Método: **POST**
  - Corpo da Solicitação: **JSON**
  - Campos:

| Chave | Tipo | Valor |
|---|---|---|
| `action` | Texto | `health` |
| `token` | Texto | seu código secreto |
| `date` | Texto | variável **Data Atual** → toque nela → Formato da Data: **Personalizado** → `yyyy-MM-dd` |
| `data` | Dicionário | com 5 itens de Texto: `kcal`, `protein`, `carbs`, `fat`, `water`, cada um com a variável de mesmo nome |

O campo `date` é opcional; sem ele o script usa a data de hoje.

## 3. Testar

Toque em **▶**. Na primeira vez o iPhone pede acesso ao Saúde: permita só os 5 tipos acima. Abra a planilha: a aba **Saúde** deve ter uma linha de hoje. No Rotina, a seção **comida** passa a mostrar as calorias e os macros.

## 4. Rodar sozinho toda noite

Atalhos → **Automação** → **+** → **Horário do Dia** (Time of Day) → **23:30**, **Diariamente** → marque **Executar Imediatamente** (Run Immediately) → **Rotina Saúde**.

Durante o dia, o botão **atualizar** na seção comida roda o atalho na hora. Volte pro Rotina depois e os números aparecem.

## Privacidade

- O atalho guarda o link do script e o **código secreto**. **Não compartilhe esse atalho** (nem por link do iCloud): quem tiver os dois consegue ler sua planilha.
- O atalho só lê os 5 tipos que você permitir. Dá pra revisar em Ajustes → Saúde → Acesso a Dados.
- Os números vão do seu iPhone direto pra sua planilha no seu Google. Não passam pelo GitHub nem ficam públicos.
