#include "mainwindow.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QFile>
#include <QTextStream>
#include <QMessageBox>
#include <QApplication>
#include <QTextCodec>
#include <QRegularExpression>
#include <QRegularExpressionMatch>

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
{
    QTextCodec::setCodecForLocale(QTextCodec::codecForName("UTF-8"));

    setWindowTitle("Markdown 编辑器");
    resize(1400, 800);

    m_treeWidget = new QTreeWidget(this);
    m_treeWidget->setHeaderLabel("Markdown 文件");
    m_treeWidget->header()->setSectionResizeMode(QHeaderView::Stretch);

    m_textEdit = new QTextEdit(this);
    m_textEdit->setFont(QFont("Consolas", 10));

    m_webView = new QWebEngineView(this);
    m_webView->settings()->setDefaultTextEncoding("UTF-8");

    QSplitter *rightSplitter = new QSplitter(Qt::Horizontal, this);
    rightSplitter->addWidget(m_textEdit);
    rightSplitter->addWidget(m_webView);
    rightSplitter->setStretchFactor(0, 1);
    rightSplitter->setStretchFactor(1, 1);

    QSplitter *mainSplitter = new QSplitter(Qt::Horizontal, this);
    mainSplitter->addWidget(m_treeWidget);
    mainSplitter->addWidget(rightSplitter);
    mainSplitter->setStretchFactor(0, 1);
    mainSplitter->setStretchFactor(1, 4);

    setCentralWidget(mainSplitter);

    connect(m_treeWidget, &QTreeWidget::itemClicked,
            this, &MainWindow::onFileItemClicked);
    connect(m_textEdit, &QTextEdit::textChanged,
            this, &MainWindow::onTextChanged);

    m_rootFolder = qApp->applicationDirPath();
    loadMarkdownFiles(m_rootFolder);
}

MainWindow::~MainWindow()
{
}

void MainWindow::loadMarkdownFiles(const QString &folderPath)
{
    m_treeWidget->clear();
    QDir dir(folderPath);
    if (!dir.exists()) {
        QMessageBox::warning(this, "警告", "文件夹不存在: " + folderPath);
        return;
    }

    QTreeWidgetItem *rootItem = new QTreeWidgetItem(m_treeWidget);
    rootItem->setText(0, dir.dirName());
    rootItem->setData(0, Qt::UserRole, folderPath);
    rootItem->setExpanded(true);

    addTreeItems(rootItem, dir);
}

void MainWindow::addTreeItems(QTreeWidgetItem *parentItem, const QDir &dir)
{
    QDir currentDir = dir;
    currentDir.setSorting(QDir::DirsFirst | QDir::Name);
    QFileInfoList fileList = currentDir.entryInfoList(QStringList() << "*", 
                                                        QDir::Dirs | QDir::Files | QDir::NoDotAndDotDot,
                                                        QDir::DirsFirst | QDir::Name);

    for (const QFileInfo &fileInfo : fileList) {
        if (fileInfo.isDir()) {
            QTreeWidgetItem *dirItem = new QTreeWidgetItem(parentItem);
            QString dirName = fileInfo.fileName();
            dirItem->setText(0, dirName);
            dirItem->setData(0, Qt::UserRole, fileInfo.absoluteFilePath());

            QDir subDir(fileInfo.absoluteFilePath());
            addTreeItems(dirItem, subDir);
        } else {
            QString suffix = fileInfo.suffix();
            if (suffix.compare("md", Qt::CaseInsensitive) == 0) {
                QTreeWidgetItem *fileItem = new QTreeWidgetItem(parentItem);
                QString fileName = fileInfo.fileName();
                fileItem->setText(0, fileName);
                fileItem->setData(0, Qt::UserRole, fileInfo.absoluteFilePath());
            }
        }
    }
}

void MainWindow::onFileItemClicked(QTreeWidgetItem *item, int column)
{
    Q_UNUSED(column);
    QString filePath = item->data(0, Qt::UserRole).toString();
    QFileInfo fileInfo(filePath);

    if (fileInfo.isFile() && fileInfo.suffix().toLower() == "md") {
        loadFileContent(filePath);
    }
}

void MainWindow::loadFileContent(const QString &filePath)
{
    QFile file(filePath);
    
    if (!file.exists()) {
        QMessageBox::warning(this, "错误", "文件不存在: " + filePath);
        return;
    }

    if (!file.open(QIODevice::ReadOnly | QIODevice::Text)) {
        QString errorMsg = QString("无法打开文件:\n%1\n\n错误信息: %2")
                               .arg(filePath, file.errorString());
        QMessageBox::warning(this, "错误", errorMsg);
        return;
    }

    QTextStream in(&file);
    in.setCodec("UTF-8");
    in.setAutoDetectUnicode(true);
    
    QString content = in.readAll();
    
    if (in.status() != QTextStream::Ok) {
        QMessageBox::warning(this, "警告", "文件读取过程中出现问题，部分内容可能无法正确显示");
    }
    
    file.close();

    m_textEdit->setPlainText(content);
    
    QFileInfo fileInfo(filePath);
    setWindowTitle(QString("Markdown 编辑器 - %1").arg(fileInfo.fileName()));
    
    updatePreview();
}

void MainWindow::onTextChanged()
{
    updatePreview();
}

void MainWindow::updatePreview()
{
    QString markdown = m_textEdit->toPlainText();
    QString html = markdownToHtml(markdown);
    m_webView->setHtml(html);
}

QString MainWindow::markdownToHtml(const QString &markdown)
{
    QString html = markdown;
    
    html.replace("&", "&amp;");
    html.replace("<", "&lt;");
    html.replace(">", "&gt;");
    
    static QRegularExpression h1Regex("^# (.+)$", QRegularExpression::MultilineOption);
    html.replace(h1Regex, "<h1>\\1</h1>");
    
    static QRegularExpression h2Regex("^## (.+)$", QRegularExpression::MultilineOption);
    html.replace(h2Regex, "<h2>\\1</h2>");
    
    static QRegularExpression h3Regex("^### (.+)$", QRegularExpression::MultilineOption);
    html.replace(h3Regex, "<h3>\\1</h3>");
    
    static QRegularExpression h4Regex("^#### (.+)$", QRegularExpression::MultilineOption);
    html.replace(h4Regex, "<h4>\\1</h4>");
    
    static QRegularExpression boldRegex("\\*\\*([^*]+)\\*\\*");
    html.replace(boldRegex, "<strong>\\1</strong>");
    
    static QRegularExpression italicRegex("\\*([^*]+)\\*");
    html.replace(italicRegex, "<em>\\1</em>");
    
    static QRegularExpression codeBlockRegex("```([\\s\\S]*?)```");
    QRegularExpressionMatchIterator it = codeBlockRegex.globalMatch(html);
    QList<QPair<int, QString>> codeBlocks;
    while (it.hasNext()) {
        QRegularExpressionMatch match = it.next();
        codeBlocks.append(qMakePair(match.capturedStart(), match.captured(1)));
    }
    for (int i = codeBlocks.size() - 1; i >= 0; --i) {
        QString code = codeBlocks[i].second;
        code.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&");
        html.replace(codeBlocks[i].first, code.length() + 6, 
                     QString("<pre><code>%1</code></pre>").arg(code));
    }
    
    static QRegularExpression inlineCodeRegex("`([^`]+)`");
    html.replace(inlineCodeRegex, "<code>\\1</code>");
    
    static QRegularExpression listRegex("^- (.+)$", QRegularExpression::MultilineOption);
    html.replace(listRegex, "<li>\\1</li>");
    
    QStringList lines = html.split("\n");
    QStringList processedLines;
    bool inList = false;
    
    for (const QString &line : lines) {
        if (line.startsWith("<li>")) {
            if (!inList) {
                processedLines.append("<ul>");
                inList = true;
            }
            processedLines.append(line);
        } else {
            if (inList) {
                processedLines.append("</ul>");
                inList = false;
            }
            if (!line.isEmpty() && !line.startsWith("<h") && 
                !line.startsWith("<pre>") && !line.startsWith("</pre>") &&
                !line.startsWith("<ul>") && !line.startsWith("</ul>")) {
                processedLines.append("<p>" + line + "</p>");
            } else {
                processedLines.append(line);
            }
        }
    }
    if (inList) {
        processedLines.append("</ul>");
    }
    
    html = processedLines.join("\n");
    
    QString fullHtml = QStringLiteral(R"(
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.6;
            padding: 20px;
            max-width: 900px;
            margin: 0 auto;
            color: #333;
        }
        h1, h2, h3, h4 {
            color: #2c3e50;
            border-bottom: 1px solid #eaecef;
            padding-bottom: 0.3em;
        }
        h1 { font-size: 2em; }
        h2 { font-size: 1.5em; }
        h3 { font-size: 1.25em; }
        h4 { font-size: 1em; }
        code {
            background-color: #f6f8fa;
            padding: 0.2em 0.4em;
            border-radius: 3px;
            font-family: SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
            font-size: 0.9em;
        }
        pre {
            background-color: #f6f8fa;
            padding: 16px;
            border-radius: 6px;
            overflow-x: auto;
        }
        pre code {
            background-color: transparent;
            padding: 0;
        }
        ul {
            padding-left: 2em;
        }
        li {
            margin: 0.25em 0;
        }
        p {
            margin: 1em 0;
        }
        strong {
            font-weight: 600;
        }
        em {
            font-style: italic;
        }
    </style>
</head>
<body>
%1
</body>
</html>
    )").arg(html);
    
    return fullHtml;
}
