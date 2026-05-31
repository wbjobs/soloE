#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include <QMainWindow>
#include <QTreeWidget>
#include <QTextEdit>
#include <QSplitter>
#include <QDir>
#include <QWebEngineView>

class MainWindow : public QMainWindow
{
    Q_OBJECT

public:
    MainWindow(QWidget *parent = nullptr);
    ~MainWindow();

private slots:
    void onFileItemClicked(QTreeWidgetItem *item, int column);
    void onTextChanged();

private:
    void loadMarkdownFiles(const QString &folderPath);
    void addTreeItems(QTreeWidgetItem *parentItem, const QDir &dir);
    void loadFileContent(const QString &filePath);
    void updatePreview();
    QString markdownToHtml(const QString &markdown);

    QTreeWidget *m_treeWidget;
    QTextEdit *m_textEdit;
    QWebEngineView *m_webView;
    QString m_rootFolder;
};

#endif // MAINWINDOW_H
